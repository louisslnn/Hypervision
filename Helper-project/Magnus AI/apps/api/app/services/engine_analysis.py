from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import chess
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db import models
from app.services.engine import (
    MATE_SCORE_CP,
    EngineEvaluation,
    EngineMetadata,
    StockfishEngineEvaluator,
    hash_fen,
)
from app.services.game_parser import parse_game_moves

BOOK_PLY_LIMIT = 10
BOOK_CPL_THRESHOLD = 15
BEST_CPL_THRESHOLD = 20
GOOD_CPL_THRESHOLD = 50
INACCURACY_CPL_THRESHOLD = 100
MISTAKE_CPL_THRESHOLD = 300


@dataclass(frozen=True)
class AnalyzeGameResult:
    analysis_version: str
    engine_name: str
    engine_version: str
    analysis_depth: int
    analysis_time_ms: int
    analysis_multipv: int
    moves_analyzed: int
    moves_skipped: int


def eval_to_cp(eval_cp: Optional[int], eval_mate: Optional[int]) -> Optional[int]:
    if eval_mate is not None:
        return MATE_SCORE_CP if eval_mate > 0 else -MATE_SCORE_CP
    return eval_cp


def calculate_cpl(
    eval_before: EngineEvaluation,
    eval_after: EngineEvaluation,
    mover_is_white: bool,
) -> Optional[int]:
    before_cp = eval_to_cp(eval_before.eval_cp, eval_before.eval_mate)
    after_cp = eval_to_cp(eval_after.eval_cp, eval_after.eval_mate)
    if before_cp is None or after_cp is None:
        return None
    before_for_mover = before_cp if mover_is_white else -before_cp
    after_for_mover = after_cp if mover_is_white else -after_cp
    delta = before_for_mover - after_for_mover
    return max(int(round(delta)), 0)


def classify_cpl(cpl: Optional[int], ply: int) -> str:
    if cpl is None:
        return "good"
    if ply <= BOOK_PLY_LIMIT and cpl <= BOOK_CPL_THRESHOLD:
        return "book"
    if cpl <= BEST_CPL_THRESHOLD:
        return "best"
    if cpl <= GOOD_CPL_THRESHOLD:
        return "good"
    if cpl <= INACCURACY_CPL_THRESHOLD:
        return "inaccuracy"
    if cpl <= MISTAKE_CPL_THRESHOLD:
        return "mistake"
    return "blunder"


def evaluation_to_json(evaluation: EngineEvaluation) -> list[dict[str, Optional[int]]]:
    return [
        {
            "eval_cp": line.eval_cp,
            "eval_mate": line.eval_mate,
            "pv_uci": line.pv_uci,
            "depth": line.depth,
        }
        for line in evaluation.multipv
    ]


def best_move_from_pv(pv_uci: Optional[str]) -> Optional[str]:
    if not pv_uci:
        return None
    return pv_uci.split()[0] if pv_uci.split() else None


def get_engine_metadata(db: Session, analysis_version: str) -> Optional[EngineMetadata]:
    stmt = (
        select(models.EnginePosition)
        .where(models.EnginePosition.analysis_version == analysis_version)
        .order_by(desc(models.EnginePosition.created_at))
    )
    position = db.execute(stmt).scalars().first()
    if not position:
        return None
    return EngineMetadata(
        name=position.engine_name,
        version=position.engine_version,
        depth=position.analysis_depth,
        time_ms=position.analysis_time_ms,
        multipv=position.analysis_multipv,
    )


def get_latest_analysis_version(db: Session, game_id: int) -> Optional[str]:
    stmt = (
        select(models.MoveAnalysis.analysis_version)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .where(models.Move.game_id == game_id)
        .order_by(desc(models.MoveAnalysis.created_at))
    )
    return db.execute(stmt).scalars().first()


def get_move_analysis(
    db: Session, move_id: int, analysis_version: Optional[str] = None
) -> Optional[models.MoveAnalysis]:
    stmt = select(models.MoveAnalysis).where(models.MoveAnalysis.move_id == move_id)
    if analysis_version:
        stmt = stmt.where(models.MoveAnalysis.analysis_version == analysis_version)
    else:
        stmt = stmt.order_by(desc(models.MoveAnalysis.created_at))
    return db.execute(stmt).scalars().first()


def get_game_analysis_rows(
    db: Session, game_id: int, analysis_version: Optional[str] = None
) -> tuple[Optional[str], list[tuple[models.MoveAnalysis, models.Move]]]:
    resolved_version = analysis_version or get_latest_analysis_version(db, game_id)
    if not resolved_version:
        return None, []

    stmt = (
        select(models.MoveAnalysis, models.Move)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .where(
            models.Move.game_id == game_id,
            models.MoveAnalysis.analysis_version == resolved_version,
        )
        .order_by(models.Move.ply)
    )
    rows = db.execute(stmt).all()
    return resolved_version, [(row[0], row[1]) for row in rows]


def ensure_engine_position(
    db: Session,
    fen: str,
    evaluator: StockfishEngineEvaluator,
    cache: dict[str, models.EnginePosition],
    force: bool = False,
) -> models.EnginePosition:
    if not evaluator.metadata:
        raise RuntimeError("Engine metadata not available.")
    analysis_version = evaluator.metadata.analysis_version
    fen_hash = hash_fen(fen)
    cache_key = f"{fen_hash}:{analysis_version}"

    if not force and cache_key in cache:
        return cache[cache_key]

    stmt = select(models.EnginePosition).where(
        models.EnginePosition.fen_hash == fen_hash,
        models.EnginePosition.analysis_version == analysis_version,
    )
    existing = db.execute(stmt).scalars().first()
    if existing and not force:
        cache[cache_key] = existing
        return existing

    evaluation = evaluator.analyze(fen)
    board = chess.Board(fen)
    side_to_move = "w" if board.turn else "b"
    multipv_json = evaluation_to_json(evaluation)

    if existing:
        existing.fen = fen
        existing.side_to_move = side_to_move
        existing.engine_name = evaluator.metadata.name
        existing.engine_version = evaluator.metadata.version
        existing.analysis_depth = evaluator.metadata.depth
        existing.analysis_time_ms = evaluator.metadata.time_ms
        existing.analysis_multipv = evaluator.metadata.multipv
        existing.analysis_version = analysis_version
        existing.eval_cp = evaluation.eval_cp
        existing.eval_mate = evaluation.eval_mate
        existing.pv_uci = evaluation.pv_uci
        existing.multipv_json = multipv_json
        cache[cache_key] = existing
        return existing

    created = models.EnginePosition(
        fen_hash=fen_hash,
        fen=fen,
        side_to_move=side_to_move,
        engine_name=evaluator.metadata.name,
        engine_version=evaluator.metadata.version,
        analysis_depth=evaluator.metadata.depth,
        analysis_time_ms=evaluator.metadata.time_ms,
        analysis_multipv=evaluator.metadata.multipv,
        analysis_version=analysis_version,
        eval_cp=evaluation.eval_cp,
        eval_mate=evaluation.eval_mate,
        pv_uci=evaluation.pv_uci,
        multipv_json=multipv_json,
    )
    db.add(created)
    cache[cache_key] = created
    return created


def analyze_game(
    db: Session,
    game: models.Game,
    evaluator: StockfishEngineEvaluator,
    force: bool = False,
    max_plies: Optional[int] = None,
) -> AnalyzeGameResult:
    if not evaluator.metadata:
        raise RuntimeError("Engine metadata not available.")

    moves = (
        db.execute(
            select(models.Move).where(models.Move.game_id == game.id).order_by(models.Move.ply)
        )
        .scalars()
        .all()
    )
    if not moves:
        parse_game_moves(db, game, force=False)
        db.commit()
        moves = (
            db.execute(
                select(models.Move).where(models.Move.game_id == game.id).order_by(models.Move.ply)
            )
            .scalars()
            .all()
        )
    if max_plies is not None:
        moves = [move for move in moves if move.ply <= max_plies]

    cache: dict[str, models.EnginePosition] = {}
    moves_analyzed = 0
    moves_skipped = 0
    analysis_version = evaluator.metadata.analysis_version

    for move in moves:
        stmt = select(models.MoveAnalysis).where(
            models.MoveAnalysis.move_id == move.id,
            models.MoveAnalysis.analysis_version == analysis_version,
        )
        existing = db.execute(stmt).scalars().first()
        if existing and not force:
            moves_skipped += 1
            continue

        before_position = ensure_engine_position(db, move.fen_before, evaluator, cache, force=force)
        after_position = ensure_engine_position(db, move.fen_after, evaluator, cache, force=force)

        before_eval = EngineEvaluation(
            eval_cp=before_position.eval_cp,
            eval_mate=before_position.eval_mate,
            pv_uci=before_position.pv_uci,
            multipv=[],
        )
        after_eval = EngineEvaluation(
            eval_cp=after_position.eval_cp,
            eval_mate=after_position.eval_mate,
            pv_uci=after_position.pv_uci,
            multipv=[],
        )

        mover_is_white = chess.Board(move.fen_before).turn
        cpl = calculate_cpl(before_eval, after_eval, mover_is_white)
        classification = classify_cpl(cpl, move.ply)
        best_move_uci = best_move_from_pv(before_position.pv_uci)

        if existing:
            analysis = existing
            analysis.eval_before_cp = before_position.eval_cp
            analysis.eval_before_mate = before_position.eval_mate
            analysis.eval_after_cp = after_position.eval_cp
            analysis.eval_after_mate = after_position.eval_mate
            analysis.cpl = cpl
            analysis.best_move_uci = best_move_uci
            analysis.best_eval_cp = before_position.eval_cp
            analysis.best_eval_mate = before_position.eval_mate
            analysis.classification = classification
            analysis.tags_json = analysis.tags_json or []
        else:
            analysis = models.MoveAnalysis(
                move_id=move.id,
                analysis_version=analysis_version,
                eval_before_cp=before_position.eval_cp,
                eval_before_mate=before_position.eval_mate,
                eval_after_cp=after_position.eval_cp,
                eval_after_mate=after_position.eval_mate,
                cpl=cpl,
                best_move_uci=best_move_uci,
                best_eval_cp=before_position.eval_cp,
                best_eval_mate=before_position.eval_mate,
                classification=classification,
                tags_json=[],
            )
            db.add(analysis)

        moves_analyzed += 1

    return AnalyzeGameResult(
        analysis_version=analysis_version,
        engine_name=evaluator.metadata.name,
        engine_version=evaluator.metadata.version,
        analysis_depth=evaluator.metadata.depth,
        analysis_time_ms=evaluator.metadata.time_ms,
        analysis_multipv=evaluator.metadata.multipv,
        moves_analyzed=moves_analyzed,
        moves_skipped=moves_skipped,
    )
