from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import chess
from sqlalchemy import and_, case, delete, desc, func, or_, select
from sqlalchemy.orm import Session

from app.db import models

WIN_RESULTS = {"win"}
DRAW_RESULTS = {
    "draw",
    "stalemate",
    "repetition",
    "agreed",
    "insufficient",
    "50move",
    "timevsinsufficient",
}
LOSS_RESULTS = {"checkmated", "resigned", "timeout", "abandoned", "lose", "time"}
BLUNDER_RESULTS = {"blunder", "mistake"}

TIME_TROUBLE_PATTERN_THRESHOLD_MS = 30000
OPENING_PLY_LIMIT = 12
IMPULSIVE_MOVE_MS = 1000
MAX_PATTERN_EXAMPLES = 3


@dataclass(frozen=True)
class PatternDefinition:
    key: str
    title: str
    description: str
    base_severity: float


@dataclass(frozen=True)
class PatternCandidate:
    game_id: int
    move_id: int
    ply: int
    move_san: str
    move_uci: str
    fen_before: str
    classification: str
    cpl: Optional[int]
    clock_remaining_ms: Optional[int]
    time_spent_ms: Optional[int]
    capture_piece: Optional[str]
    best_move_uci: Optional[str]


@dataclass(frozen=True)
class PatternMatch:
    move_id: int
    game_id: int
    fen: str
    cpl: Optional[int]
    notes: Optional[str]


@dataclass(frozen=True)
class InsightsContext:
    player: models.Player
    analysis_version: Optional[str]


def get_player(db: Session, username: str) -> models.Player:
    normalized = username.strip()
    if not normalized:
        raise ValueError("username is required.")
    player = (
        db.execute(select(models.Player).where(models.Player.username == normalized))
        .scalars()
        .first()
    )
    if not player:
        raise ValueError("Player not found.")
    return player


def resolve_analysis_version(
    db: Session, player: models.Player, analysis_version: Optional[str]
) -> Optional[str]:
    if analysis_version:
        return analysis_version
    stmt = (
        select(models.MoveAnalysis.analysis_version)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .join(models.Game, models.Move.game_id == models.Game.id)
        .where(models.Game.player_id == player.id)
        .order_by(desc(models.MoveAnalysis.created_at))
    )
    return db.execute(stmt).scalars().first()


def build_context(db: Session, username: str, analysis_version: Optional[str]) -> InsightsContext:
    player = get_player(db, username)
    resolved_version = resolve_analysis_version(db, player, analysis_version)
    return InsightsContext(player=player, analysis_version=resolved_version)


PATTERN_DEFINITIONS: dict[str, PatternDefinition] = {
    "time_trouble_blunder": PatternDefinition(
        key="time_trouble_blunder",
        title="Time trouble blunders",
        description="Mistakes and blunders played under low remaining clock.",
        base_severity=0.6,
    ),
    "opening_slip": PatternDefinition(
        key="opening_slip",
        title="Opening slips",
        description="Early-phase mistakes before the opening settles.",
        base_severity=0.4,
    ),
    "greedy_capture": PatternDefinition(
        key="greedy_capture",
        title="Greedy captures",
        description="Captures that led to large evaluation drops.",
        base_severity=0.5,
    ),
    "impulsive_blunder": PatternDefinition(
        key="impulsive_blunder",
        title="Impulsive mistakes",
        description="Very fast moves that turned into mistakes or blunders.",
        base_severity=0.45,
    ),
    "missed_tactic": PatternDefinition(
        key="missed_tactic",
        title="Missed tactics",
        description="Missed tactical shots like captures or checks recommended by the engine.",
        base_severity=0.55,
    ),
}


def player_filters(username: str):
    player_is_white = models.Game.white_username == username
    player_is_black = models.Game.black_username == username
    player_move_filter = or_(
        and_(player_is_white, models.Move.ply % 2 == 1),
        and_(player_is_black, models.Move.ply % 2 == 0),
    )
    return player_is_white, player_is_black, player_move_filter


def build_board(fen: str) -> Optional[chess.Board]:
    try:
        if fen == "start":
            return chess.Board()
        return chess.Board(fen)
    except ValueError:
        return None


def safe_move(board: chess.Board, uci: Optional[str]) -> Optional[chess.Move]:
    if not uci:
        return None
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return None
    if move not in board.legal_moves:
        return None
    return move


def is_tactical_move(board: chess.Board, move: Optional[chess.Move]) -> bool:
    if not move:
        return False
    return board.is_capture(move) or board.gives_check(move)


def get_last_sync(db: Session, username: str):
    stmt = (
        select(models.SyncRun)
        .where(models.SyncRun.player_username == username)
        .order_by(desc(models.SyncRun.created_at))
    )
    return db.execute(stmt).scalars().first()


def get_overview(db: Session, context: InsightsContext):
    username = context.player.username
    player_is_white, player_is_black, player_move_filter = player_filters(username)
    game_filter = models.Game.player_id == context.player.id

    games_stmt = select(func.count(models.Game.id)).where(game_filter)
    games_count = int(db.execute(games_stmt).scalar() or 0)

    move_stmt = (
        select(
            func.count(models.MoveAnalysis.id),
            func.avg(models.MoveAnalysis.cpl),
            func.sum(case((models.MoveAnalysis.classification == "blunder", 1), else_=0)),
            func.sum(case((models.MoveAnalysis.classification == "mistake", 1), else_=0)),
            func.sum(case((models.MoveAnalysis.classification == "inaccuracy", 1), else_=0)),
        )
        .select_from(models.MoveAnalysis)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .join(models.Game, models.Move.game_id == models.Game.id)
        .where(game_filter, player_move_filter, or_(player_is_white, player_is_black))
    )
    if context.analysis_version:
        move_stmt = move_stmt.where(
            models.MoveAnalysis.analysis_version == context.analysis_version
        )
    row = db.execute(move_stmt).one()
    moves_analyzed = int(row[0] or 0)
    avg_cpl = float(row[1]) if row[1] is not None else None
    blunders = int(row[2] or 0)
    mistakes = int(row[3] or 0)
    inaccuracies = int(row[4] or 0)

    last_sync = get_last_sync(db, username)
    return {
        "player_username": username,
        "analysis_version": context.analysis_version,
        "games": games_count,
        "moves_analyzed": moves_analyzed,
        "average_cpl": avg_cpl,
        "blunders": blunders,
        "mistakes": mistakes,
        "inaccuracies": inaccuracies,
        "last_sync": last_sync.finished_at if last_sync else None,
    }


def get_openings(db: Session, context: InsightsContext):
    username = context.player.username
    player_is_white, player_is_black, player_move_filter = player_filters(username)
    game_filter = models.Game.player_id == context.player.id

    opening_label = func.coalesce(models.Game.eco_url, "Unknown")
    player_result = case(
        (player_is_white, models.Game.result_white),
        (player_is_black, models.Game.result_black),
        else_=None,
    )

    games_stmt = (
        select(
            opening_label.label("opening"),
            func.count(models.Game.id).label("games"),
            func.sum(case((player_result.in_(WIN_RESULTS), 1), else_=0)).label("wins"),
            func.sum(case((player_result.in_(LOSS_RESULTS), 1), else_=0)).label("losses"),
            func.sum(case((player_result.in_(DRAW_RESULTS), 1), else_=0)).label("draws"),
        )
        .where(game_filter)
        .group_by(opening_label)
        .order_by(desc("games"))
    )
    games_rows = db.execute(games_stmt).all()

    cpl_map: dict[str, Optional[float]] = {}
    if context.analysis_version:
        cpl_stmt = (
            select(opening_label.label("opening"), func.avg(models.MoveAnalysis.cpl))
            .select_from(models.MoveAnalysis)
            .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
            .join(models.Game, models.Move.game_id == models.Game.id)
            .where(
                game_filter,
                player_move_filter,
                or_(player_is_white, player_is_black),
                models.MoveAnalysis.analysis_version == context.analysis_version,
            )
            .group_by(opening_label)
        )
        for opening, avg_cpl in db.execute(cpl_stmt).all():
            cpl_map[str(opening)] = float(avg_cpl) if avg_cpl is not None else None

    openings = []
    for row in games_rows:
        opening = str(row.opening)
        games = int(row.games or 0)
        wins = int(row.wins or 0)
        losses = int(row.losses or 0)
        draws = int(row.draws or 0)
        win_rate = wins / games if games else 0.0
        openings.append(
            {
                "opening": opening,
                "games": games,
                "wins": wins,
                "losses": losses,
                "draws": draws,
                "win_rate": win_rate,
                "average_cpl": cpl_map.get(opening),
            }
        )

    return {
        "player_username": username,
        "analysis_version": context.analysis_version,
        "openings": openings,
    }


def get_time_insights(db: Session, context: InsightsContext, threshold_ms: int):
    username = context.player.username
    player_is_white, player_is_black, player_move_filter = player_filters(username)
    game_filter = models.Game.player_id == context.player.id
    time_trouble_condition = and_(
        models.Move.clock_remaining_ms.is_not(None),
        models.Move.clock_remaining_ms <= threshold_ms,
    )

    time_stmt = (
        select(
            func.avg(models.Move.time_spent_ms),
            func.sum(case((time_trouble_condition, 1), else_=0)).label("time_trouble_moves"),
        )
        .select_from(models.Move)
        .join(models.Game, models.Move.game_id == models.Game.id)
        .where(game_filter, player_move_filter, or_(player_is_white, player_is_black))
    )
    row = db.execute(time_stmt).one()
    avg_time_spent = float(row[0]) if row[0] is not None else None
    time_trouble_moves = int(row[1] or 0)

    time_trouble_blunders = 0
    avg_cpl_time_trouble = None
    avg_cpl_normal = None

    if context.analysis_version:
        cpl_stmt = (
            select(
                func.sum(
                    case(
                        (
                            and_(
                                time_trouble_condition,
                                models.MoveAnalysis.classification.in_(BLUNDER_RESULTS),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("time_trouble_blunders"),
                func.avg(case((time_trouble_condition, models.MoveAnalysis.cpl), else_=None)).label(
                    "avg_cpl_time_trouble"
                ),
                func.avg(case((time_trouble_condition, None), else_=models.MoveAnalysis.cpl)).label(
                    "avg_cpl_normal"
                ),
            )
            .select_from(models.MoveAnalysis)
            .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
            .join(models.Game, models.Move.game_id == models.Game.id)
            .where(
                game_filter,
                player_move_filter,
                or_(player_is_white, player_is_black),
                models.MoveAnalysis.analysis_version == context.analysis_version,
            )
        )
        cpl_row = db.execute(cpl_stmt).one()
        time_trouble_blunders = int(cpl_row[0] or 0)
        avg_cpl_time_trouble = float(cpl_row[1]) if cpl_row[1] is not None else None
        avg_cpl_normal = float(cpl_row[2]) if cpl_row[2] is not None else None

    return {
        "player_username": username,
        "analysis_version": context.analysis_version,
        "time_trouble_threshold_ms": threshold_ms,
        "avg_time_spent_ms": avg_time_spent,
        "time_trouble_moves": time_trouble_moves,
        "time_trouble_blunders": time_trouble_blunders,
        "avg_cpl_time_trouble": avg_cpl_time_trouble,
        "avg_cpl_normal": avg_cpl_normal,
    }


def collect_pattern_candidates(db: Session, context: InsightsContext) -> list[PatternCandidate]:
    username = context.player.username
    player_is_white, player_is_black, player_move_filter = player_filters(username)
    game_filter = models.Game.player_id == context.player.id

    stmt = (
        select(models.MoveAnalysis, models.Move)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .join(models.Game, models.Move.game_id == models.Game.id)
        .where(
            game_filter,
            player_move_filter,
            or_(player_is_white, player_is_black),
            models.MoveAnalysis.analysis_version == context.analysis_version,
        )
        .order_by(desc(models.MoveAnalysis.cpl).nulls_last(), models.Move.ply)
    )
    candidates: list[PatternCandidate] = []
    for analysis, move in db.execute(stmt).all():
        candidates.append(
            PatternCandidate(
                game_id=move.game_id,
                move_id=move.id,
                ply=move.ply,
                move_san=move.move_san,
                move_uci=move.move_uci,
                fen_before=move.fen_before,
                classification=analysis.classification,
                cpl=analysis.cpl,
                clock_remaining_ms=move.clock_remaining_ms,
                time_spent_ms=move.time_spent_ms,
                capture_piece=move.capture_piece,
                best_move_uci=analysis.best_move_uci,
            )
        )
    return candidates


def identify_pattern_matches(candidate: PatternCandidate) -> list[tuple[str, Optional[str]]]:
    matches: list[tuple[str, Optional[str]]] = []
    if candidate.classification in BLUNDER_RESULTS:
        if (
            candidate.clock_remaining_ms is not None
            and candidate.clock_remaining_ms <= TIME_TROUBLE_PATTERN_THRESHOLD_MS
        ):
            matches.append(
                (
                    "time_trouble_blunder",
                    f"Clock {candidate.clock_remaining_ms} ms",
                )
            )
        if candidate.ply <= OPENING_PLY_LIMIT:
            matches.append(("opening_slip", "Early phase mistake"))
        if candidate.capture_piece:
            matches.append(("greedy_capture", "Capture led to evaluation loss"))
        if candidate.time_spent_ms is not None and candidate.time_spent_ms <= IMPULSIVE_MOVE_MS:
            matches.append(
                (
                    "impulsive_blunder",
                    f"Spent {candidate.time_spent_ms} ms",
                )
            )

    if candidate.classification in {"inaccuracy", "mistake", "blunder"}:
        board = build_board(candidate.fen_before)
        if board:
            actual_move = safe_move(board, candidate.move_uci)
            best_move = safe_move(board, candidate.best_move_uci)
            if actual_move and best_move:
                best_is_tactical = is_tactical_move(board, best_move)
                actual_is_tactical = is_tactical_move(board, actual_move)
                if best_is_tactical and not actual_is_tactical:
                    matches.append(("missed_tactic", "Best move was a tactical shot"))

    return matches


def compute_severity(
    definition: PatternDefinition, occurrences: int, avg_cpl: Optional[float]
) -> float:
    cpl_component = min((avg_cpl or 0.0) / 400.0, 0.3)
    freq_component = min(occurrences / 10.0, 0.3)
    return min(1.0, definition.base_severity + cpl_component + freq_component)


def refresh_patterns(db: Session, context: InsightsContext) -> list[models.Pattern]:
    if not context.analysis_version:
        return []

    existing = (
        db.execute(
            select(models.Pattern).where(
                models.Pattern.player_id == context.player.id,
                models.Pattern.analysis_version == context.analysis_version,
            )
        )
        .scalars()
        .all()
    )
    if existing:
        pattern_ids = [pattern.id for pattern in existing]
        db.execute(
            delete(models.PatternExample).where(models.PatternExample.pattern_id.in_(pattern_ids))
        )
        db.execute(delete(models.Pattern).where(models.Pattern.id.in_(pattern_ids)))

    candidates = collect_pattern_candidates(db, context)
    pattern_matches: dict[str, list[PatternMatch]] = {key: [] for key in PATTERN_DEFINITIONS}

    for candidate in candidates:
        for key, note in identify_pattern_matches(candidate):
            pattern_matches[key].append(
                PatternMatch(
                    move_id=candidate.move_id,
                    game_id=candidate.game_id,
                    fen=candidate.fen_before,
                    cpl=candidate.cpl,
                    notes=note,
                )
            )

    created: list[models.Pattern] = []
    for key, matches in pattern_matches.items():
        if not matches:
            continue
        definition = PATTERN_DEFINITIONS[key]
        cpl_values = [match.cpl for match in matches if match.cpl is not None]
        avg_cpl = sum(cpl_values) / len(cpl_values) if cpl_values else None
        severity = compute_severity(definition, len(matches), avg_cpl)

        pattern = models.Pattern(
            player_id=context.player.id,
            analysis_version=context.analysis_version,
            pattern_key=definition.key,
            title=definition.title,
            description=definition.description,
            severity_score=severity,
            occurrences=len(matches),
            average_cpl=avg_cpl,
        )
        db.add(pattern)
        db.flush()

        matches_sorted = sorted(
            matches,
            key=lambda item: (item.cpl is None, -(item.cpl or 0)),
        )
        for match in matches_sorted[:MAX_PATTERN_EXAMPLES]:
            db.add(
                models.PatternExample(
                    pattern_id=pattern.id,
                    game_id=match.game_id,
                    move_id=match.move_id,
                    fen=match.fen,
                    notes=match.notes,
                )
            )
        created.append(pattern)

    return created


def get_patterns(db: Session, context: InsightsContext):
    username = context.player.username

    if not context.analysis_version:
        return {
            "player_username": username,
            "analysis_version": context.analysis_version,
            "patterns": [],
        }

    refresh_patterns(db, context)
    db.commit()

    patterns_stmt = (
        select(models.Pattern)
        .where(
            models.Pattern.player_id == context.player.id,
            models.Pattern.analysis_version == context.analysis_version,
        )
        .order_by(desc(models.Pattern.occurrences), desc(models.Pattern.severity_score))
    )
    patterns = db.execute(patterns_stmt).scalars().all()

    examples_map: dict[int, list[dict[str, Optional[str]]]] = {}
    if patterns:
        pattern_ids = [pattern.id for pattern in patterns]
        examples = db.execute(
            select(models.PatternExample).where(models.PatternExample.pattern_id.in_(pattern_ids))
        ).scalars()
        for example in examples:
            examples_map.setdefault(example.pattern_id, []).append(
                {
                    "game_id": example.game_id,
                    "move_id": example.move_id,
                    "fen": example.fen,
                    "notes": example.notes,
                }
            )

    response_patterns = []
    for pattern in patterns:
        response_patterns.append(
            {
                "pattern_key": pattern.pattern_key,
                "title": pattern.title,
                "description": pattern.description,
                "occurrences": pattern.occurrences,
                "average_cpl": pattern.average_cpl,
                "severity_score": pattern.severity_score,
                "examples": examples_map.get(pattern.id, []),
            }
        )

    return {
        "player_username": username,
        "analysis_version": context.analysis_version,
        "patterns": response_patterns,
    }
