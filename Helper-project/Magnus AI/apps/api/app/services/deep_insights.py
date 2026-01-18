"""
Deep Insights Service - Elite-level chess analysis for world champion preparation.

This service provides comprehensive analysis of the last N games including:
- Game-by-game performance breakdown with critical moments
- Opening repertoire analysis with specific recommendations
- Time management patterns by game phase
- Move quality trends and consistency analysis
- Tactical and positional weakness identification
- LLM-powered elite coaching insights
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

import chess
from sqlalchemy import and_, case, desc, func, or_, select
from sqlalchemy.orm import Session

from app.db import models
from app.services.engine import hash_fen
from app.services.insights import (
    BLUNDER_RESULTS,
    DRAW_RESULTS,
    LOSS_RESULTS,
    WIN_RESULTS,
    build_board,
    get_player,
    player_filters,
    safe_move,
)

# Constants for deep analysis
DEFAULT_GAME_LIMIT = 10
MAX_GAME_LIMIT = 25  # API cost control
MAX_CRITICAL_MOMENTS_PER_GAME = 5
OPENING_PLY_LIMIT = 16  # First 8 full moves
MIDDLEGAME_PLY_START = 17
MIDDLEGAME_PLY_END = 50
ENDGAME_PLY_START = 51

# Time thresholds (ms)
FAST_MOVE_MS = 3000
SLOW_MOVE_MS = 30000
TIME_TROUBLE_REMAINING_MS = 30000
CRITICAL_TIME_REMAINING_MS = 10000

# CPL thresholds for move quality
EXCELLENT_CPL = 5
GOOD_CPL = 15
INACCURACY_CPL = 50
MISTAKE_CPL = 100
BLUNDER_CPL = 200


@dataclass
class GamePhaseStats:
    """Statistics for a specific game phase."""
    phase: str
    moves: int = 0
    avg_cpl: Optional[float] = None
    blunders: int = 0
    mistakes: int = 0
    inaccuracies: int = 0
    excellent_moves: int = 0
    avg_time_spent_ms: Optional[float] = None
    time_trouble_moves: int = 0
    total_cpl: int = 0
    total_time_ms: int = 0


@dataclass
class CriticalMomentDetail:
    """Detailed information about a critical moment in a game."""
    move_id: int
    game_id: int
    ply: int
    move_san: str
    move_uci: str
    fen_before: str
    fen_hash: str
    classification: str
    cpl: Optional[int]
    best_move_uci: Optional[str]
    eval_before_cp: Optional[int]
    eval_before_mate: Optional[int]
    eval_after_cp: Optional[int]
    eval_after_mate: Optional[int]
    clock_remaining_ms: Optional[int]
    time_spent_ms: Optional[int]
    phase: str
    is_tactical: bool = False
    pv_uci: Optional[str] = None


@dataclass
class GameDeepAnalysis:
    """Deep analysis for a single game."""
    game_id: int
    result: str  # win/draw/loss
    player_color: str
    opponent_username: Optional[str]
    opponent_rating: Optional[int]
    opening: Optional[str]
    time_control: Optional[str]
    played_at: Optional[datetime]
    total_moves: int
    avg_cpl: Optional[float]
    phases: dict[str, GamePhaseStats] = field(default_factory=dict)
    critical_moments: list[CriticalMomentDetail] = field(default_factory=list)
    time_trouble_entered_at: Optional[int] = None  # ply when entered time trouble
    blunders: int = 0
    mistakes: int = 0
    inaccuracies: int = 0
    excellent_moves: int = 0


@dataclass  
class OpeningDeepAnalysis:
    """Deep analysis for an opening."""
    opening_name: str
    eco_url: Optional[str]
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    avg_cpl: Optional[float]
    avg_cpl_opening_phase: Optional[float]
    common_mistakes: list[CriticalMomentDetail] = field(default_factory=list)
    best_games: list[int] = field(default_factory=list)
    worst_games: list[int] = field(default_factory=list)


@dataclass
class TimeManagementDeepAnalysis:
    """Deep time management analysis."""
    avg_time_per_move_ms: Optional[float]
    opening_avg_time_ms: Optional[float]
    middlegame_avg_time_ms: Optional[float]
    endgame_avg_time_ms: Optional[float]
    games_with_time_trouble: int
    total_games: int
    time_trouble_rate: float
    avg_ply_entering_time_trouble: Optional[float]
    blunders_in_time_trouble: int
    blunders_total: int
    time_trouble_blunder_rate: float
    avg_cpl_fast_moves: Optional[float]  # < 3 seconds
    avg_cpl_normal_moves: Optional[float]  # 3-30 seconds
    avg_cpl_slow_moves: Optional[float]  # > 30 seconds
    fastest_blunders: list[CriticalMomentDetail] = field(default_factory=list)


@dataclass
class DeepInsightsPayload:
    """Complete deep insights payload for LLM analysis."""
    player_username: str
    analysis_version: Optional[str]
    date_range_start: Optional[datetime]
    date_range_end: Optional[datetime]
    games_analyzed: int
    overall_stats: dict[str, Any]
    game_analyses: list[GameDeepAnalysis]
    opening_analyses: list[OpeningDeepAnalysis]
    time_management: TimeManagementDeepAnalysis
    phase_trends: dict[str, dict[str, Any]]
    improvement_signals: list[dict[str, Any]]
    regression_signals: list[dict[str, Any]]


def get_game_phase(ply: int) -> str:
    """Determine the game phase from ply number."""
    if ply <= OPENING_PLY_LIMIT:
        return "opening"
    elif ply <= MIDDLEGAME_PLY_END:
        return "middlegame"
    else:
        return "endgame"


def determine_result(game: models.Game, player_username: str) -> str:
    """Determine the result from the player's perspective."""
    if game.white_username == player_username:
        result = game.result_white
    else:
        result = game.result_black
    
    if result in WIN_RESULTS:
        return "win"
    elif result in LOSS_RESULTS:
        return "loss"
    elif result in DRAW_RESULTS:
        return "draw"
    return "unknown"


def is_tactical_position(board: chess.Board, move_uci: Optional[str], best_move_uci: Optional[str]) -> bool:
    """Check if the position involves tactical elements."""
    if not best_move_uci:
        return False
    
    best_move = safe_move(board, best_move_uci)
    if best_move:
        if board.is_capture(best_move) or board.gives_check(best_move):
            return True
    
    if move_uci:
        actual_move = safe_move(board, move_uci)
        if actual_move and (board.is_capture(actual_move) or board.gives_check(actual_move)):
            return True
    
    return False


def get_recent_games(
    db: Session,
    player_id: int,
    limit: int = DEFAULT_GAME_LIMIT,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> list[models.Game]:
    """Get the most recent analyzed games for a player."""
    stmt = (
        select(models.Game)
        .where(models.Game.player_id == player_id)
        .order_by(desc(models.Game.end_time).nulls_last(), desc(models.Game.id))
    )
    
    if date_from:
        stmt = stmt.where(models.Game.end_time >= date_from)
    if date_to:
        stmt = stmt.where(models.Game.end_time <= date_to)
    
    stmt = stmt.limit(min(limit, MAX_GAME_LIMIT))
    return list(db.execute(stmt).scalars().all())


def get_game_analysis_data(
    db: Session,
    game_id: int,
    analysis_version: Optional[str] = None,
) -> list[tuple[models.MoveAnalysis, models.Move]]:
    """Get all move analysis data for a game."""
    stmt = (
        select(models.MoveAnalysis, models.Move)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .where(models.Move.game_id == game_id)
        .order_by(models.Move.ply)
    )
    
    if analysis_version:
        stmt = stmt.where(models.MoveAnalysis.analysis_version == analysis_version)
    
    return list(db.execute(stmt).all())


def resolve_analysis_version(db: Session, player_id: int) -> Optional[str]:
    """Get the most recent analysis version for a player's games."""
    stmt = (
        select(models.MoveAnalysis.analysis_version)
        .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
        .join(models.Game, models.Move.game_id == models.Game.id)
        .where(models.Game.player_id == player_id)
        .order_by(desc(models.MoveAnalysis.created_at))
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def analyze_single_game(
    db: Session,
    game: models.Game,
    player_username: str,
    analysis_version: Optional[str],
) -> Optional[GameDeepAnalysis]:
    """Perform deep analysis on a single game."""
    rows = get_game_analysis_data(db, game.id, analysis_version)
    if not rows:
        return None
    
    # Determine player's color and filter moves
    player_color = "white" if game.white_username == player_username else "black"
    player_moves = [
        (analysis, move) for analysis, move in rows
        if (player_color == "white" and move.ply % 2 == 1) or
           (player_color == "black" and move.ply % 2 == 0)
    ]
    
    if not player_moves:
        return None
    
    # Initialize phase stats
    phases: dict[str, GamePhaseStats] = {
        "opening": GamePhaseStats(phase="opening"),
        "middlegame": GamePhaseStats(phase="middlegame"),
        "endgame": GamePhaseStats(phase="endgame"),
    }
    
    critical_moments: list[CriticalMomentDetail] = []
    total_cpl = 0
    cpl_count = 0
    blunders = mistakes = inaccuracies = excellent = 0
    time_trouble_entered_at = None
    
    for analysis, move in player_moves:
        phase = get_game_phase(move.ply)
        phase_stats = phases[phase]
        phase_stats.moves += 1
        
        # Track CPL
        if analysis.cpl is not None:
            total_cpl += analysis.cpl
            cpl_count += 1
            phase_stats.total_cpl += analysis.cpl
            
            if analysis.cpl >= BLUNDER_CPL:
                phase_stats.blunders += 1
                blunders += 1
            elif analysis.cpl >= MISTAKE_CPL:
                phase_stats.mistakes += 1
                mistakes += 1
            elif analysis.cpl >= INACCURACY_CPL:
                phase_stats.inaccuracies += 1
                inaccuracies += 1
            elif analysis.cpl <= EXCELLENT_CPL:
                phase_stats.excellent_moves += 1
                excellent += 1
        
        # Track time
        if move.time_spent_ms is not None:
            phase_stats.total_time_ms += move.time_spent_ms
            
            if move.clock_remaining_ms is not None:
                if move.clock_remaining_ms <= TIME_TROUBLE_REMAINING_MS:
                    phase_stats.time_trouble_moves += 1
                    if time_trouble_entered_at is None:
                        time_trouble_entered_at = move.ply
        
        # Build critical moment if significant
        if analysis.cpl is not None and analysis.cpl >= INACCURACY_CPL:
            board = build_board(move.fen_before)
            is_tactical = False
            if board:
                is_tactical = is_tactical_position(board, move.move_uci, analysis.best_move_uci)
            
            critical_moments.append(CriticalMomentDetail(
                move_id=move.id,
                game_id=game.id,
                ply=move.ply,
                move_san=move.move_san,
                move_uci=move.move_uci,
                fen_before=move.fen_before,
                fen_hash=hash_fen(move.fen_before),
                classification=analysis.classification,
                cpl=analysis.cpl,
                best_move_uci=analysis.best_move_uci,
                eval_before_cp=analysis.eval_before_cp,
                eval_before_mate=analysis.eval_before_mate,
                eval_after_cp=analysis.eval_after_cp,
                eval_after_mate=analysis.eval_after_mate,
                clock_remaining_ms=move.clock_remaining_ms,
                time_spent_ms=move.time_spent_ms,
                phase=phase,
                is_tactical=is_tactical,
            ))
    
    # Sort critical moments by CPL and limit
    critical_moments.sort(key=lambda x: x.cpl or 0, reverse=True)
    critical_moments = critical_moments[:MAX_CRITICAL_MOMENTS_PER_GAME]
    
    # Calculate phase averages
    for phase_stats in phases.values():
        if phase_stats.moves > 0:
            phase_stats.avg_cpl = phase_stats.total_cpl / phase_stats.moves if phase_stats.total_cpl else None
            phase_stats.avg_time_spent_ms = phase_stats.total_time_ms / phase_stats.moves if phase_stats.total_time_ms else None
    
    # Determine opponent info
    opponent_username = game.black_username if player_color == "white" else game.white_username
    opponent_rating = game.black_rating_post if player_color == "white" else game.white_rating_post
    
    return GameDeepAnalysis(
        game_id=game.id,
        result=determine_result(game, player_username),
        player_color=player_color,
        opponent_username=opponent_username,
        opponent_rating=opponent_rating,
        opening=game.eco_url,
        time_control=game.time_control,
        played_at=game.end_time,
        total_moves=len(player_moves),
        avg_cpl=total_cpl / cpl_count if cpl_count > 0 else None,
        phases=phases,
        critical_moments=critical_moments,
        time_trouble_entered_at=time_trouble_entered_at,
        blunders=blunders,
        mistakes=mistakes,
        inaccuracies=inaccuracies,
        excellent_moves=excellent,
    )


def analyze_openings(
    game_analyses: list[GameDeepAnalysis],
) -> list[OpeningDeepAnalysis]:
    """Analyze opening performance across games."""
    opening_data: dict[str, dict[str, Any]] = {}
    
    for game in game_analyses:
        opening_key = game.opening or "Unknown"
        
        if opening_key not in opening_data:
            opening_data[opening_key] = {
                "games": [],
                "cpls": [],
                "opening_phase_cpls": [],
                "mistakes_in_opening": [],
            }
        
        opening_data[opening_key]["games"].append(game)
        
        if game.avg_cpl is not None:
            opening_data[opening_key]["cpls"].append(game.avg_cpl)
        
        opening_phase = game.phases.get("opening")
        if opening_phase and opening_phase.avg_cpl is not None:
            opening_data[opening_key]["opening_phase_cpls"].append(opening_phase.avg_cpl)
        
        # Collect opening phase mistakes
        for moment in game.critical_moments:
            if moment.phase == "opening":
                opening_data[opening_key]["mistakes_in_opening"].append(moment)
    
    results: list[OpeningDeepAnalysis] = []
    for opening_key, data in opening_data.items():
        games = data["games"]
        wins = sum(1 for g in games if g.result == "win")
        losses = sum(1 for g in games if g.result == "loss")
        draws = sum(1 for g in games if g.result == "draw")
        
        cpls = data["cpls"]
        opening_cpls = data["opening_phase_cpls"]
        
        # Sort games by CPL for best/worst
        games_with_cpl = [(g, g.avg_cpl) for g in games if g.avg_cpl is not None]
        games_with_cpl.sort(key=lambda x: x[1] or 999)
        
        best_games = [g.game_id for g, _ in games_with_cpl[:3]]
        worst_games = [g.game_id for g, _ in games_with_cpl[-3:]] if len(games_with_cpl) > 3 else []
        
        # Get top mistakes in this opening
        mistakes = data["mistakes_in_opening"]
        mistakes.sort(key=lambda x: x.cpl or 0, reverse=True)
        
        results.append(OpeningDeepAnalysis(
            opening_name=opening_key.split("/")[-1] if "/" in opening_key else opening_key,
            eco_url=opening_key if opening_key != "Unknown" else None,
            games=len(games),
            wins=wins,
            losses=losses,
            draws=draws,
            win_rate=wins / len(games) if games else 0,
            avg_cpl=sum(cpls) / len(cpls) if cpls else None,
            avg_cpl_opening_phase=sum(opening_cpls) / len(opening_cpls) if opening_cpls else None,
            common_mistakes=mistakes[:3],
            best_games=best_games,
            worst_games=worst_games,
        ))
    
    # Sort by games played descending
    results.sort(key=lambda x: x.games, reverse=True)
    return results


def analyze_time_management(
    game_analyses: list[GameDeepAnalysis],
) -> TimeManagementDeepAnalysis:
    """Comprehensive time management analysis."""
    all_time_data: list[int] = []
    opening_times: list[int] = []
    middlegame_times: list[int] = []
    endgame_times: list[int] = []
    
    games_with_time_trouble = 0
    time_trouble_plies: list[int] = []
    blunders_in_time_trouble = 0
    blunders_total = 0
    
    fast_move_cpls: list[int] = []
    normal_move_cpls: list[int] = []
    slow_move_cpls: list[int] = []
    fastest_blunders: list[CriticalMomentDetail] = []
    
    for game in game_analyses:
        if game.time_trouble_entered_at is not None:
            games_with_time_trouble += 1
            time_trouble_plies.append(game.time_trouble_entered_at)
        
        blunders_total += game.blunders
        
        for phase_name, phase in game.phases.items():
            if phase.avg_time_spent_ms is not None and phase.moves > 0:
                avg_time = phase.avg_time_spent_ms
                if phase_name == "opening":
                    opening_times.append(int(avg_time))
                elif phase_name == "middlegame":
                    middlegame_times.append(int(avg_time))
                elif phase_name == "endgame":
                    endgame_times.append(int(avg_time))
        
        # Analyze critical moments for time patterns
        for moment in game.critical_moments:
            if moment.time_spent_ms is not None and moment.cpl is not None:
                if moment.time_spent_ms < FAST_MOVE_MS:
                    fast_move_cpls.append(moment.cpl)
                    if moment.cpl >= BLUNDER_CPL:
                        fastest_blunders.append(moment)
                elif moment.time_spent_ms <= SLOW_MOVE_MS:
                    normal_move_cpls.append(moment.cpl)
                else:
                    slow_move_cpls.append(moment.cpl)
                
                if moment.clock_remaining_ms is not None and moment.clock_remaining_ms <= TIME_TROUBLE_REMAINING_MS:
                    if moment.cpl >= BLUNDER_CPL:
                        blunders_in_time_trouble += 1
    
    # Sort fastest blunders
    fastest_blunders.sort(key=lambda x: x.time_spent_ms or 999999)
    
    time_trouble_rate = games_with_time_trouble / len(game_analyses) if game_analyses else 0
    tt_blunder_rate = blunders_in_time_trouble / blunders_total if blunders_total > 0 else 0
    
    return TimeManagementDeepAnalysis(
        avg_time_per_move_ms=sum(all_time_data) / len(all_time_data) if all_time_data else None,
        opening_avg_time_ms=sum(opening_times) / len(opening_times) if opening_times else None,
        middlegame_avg_time_ms=sum(middlegame_times) / len(middlegame_times) if middlegame_times else None,
        endgame_avg_time_ms=sum(endgame_times) / len(endgame_times) if endgame_times else None,
        games_with_time_trouble=games_with_time_trouble,
        total_games=len(game_analyses),
        time_trouble_rate=time_trouble_rate,
        avg_ply_entering_time_trouble=sum(time_trouble_plies) / len(time_trouble_plies) if time_trouble_plies else None,
        blunders_in_time_trouble=blunders_in_time_trouble,
        blunders_total=blunders_total,
        time_trouble_blunder_rate=tt_blunder_rate,
        avg_cpl_fast_moves=sum(fast_move_cpls) / len(fast_move_cpls) if fast_move_cpls else None,
        avg_cpl_normal_moves=sum(normal_move_cpls) / len(normal_move_cpls) if normal_move_cpls else None,
        avg_cpl_slow_moves=sum(slow_move_cpls) / len(slow_move_cpls) if slow_move_cpls else None,
        fastest_blunders=fastest_blunders[:5],
    )


def analyze_phase_trends(
    game_analyses: list[GameDeepAnalysis],
) -> dict[str, dict[str, Any]]:
    """Analyze trends in each game phase."""
    trends: dict[str, dict[str, Any]] = {
        "opening": {"cpls": [], "blunders": 0, "mistakes": 0, "excellent": 0, "moves": 0},
        "middlegame": {"cpls": [], "blunders": 0, "mistakes": 0, "excellent": 0, "moves": 0},
        "endgame": {"cpls": [], "blunders": 0, "mistakes": 0, "excellent": 0, "moves": 0},
    }
    
    for game in game_analyses:
        for phase_name, phase in game.phases.items():
            if phase_name in trends:
                if phase.avg_cpl is not None:
                    trends[phase_name]["cpls"].append(phase.avg_cpl)
                trends[phase_name]["blunders"] += phase.blunders
                trends[phase_name]["mistakes"] += phase.mistakes
                trends[phase_name]["excellent"] += phase.excellent_moves
                trends[phase_name]["moves"] += phase.moves
    
    # Calculate averages
    for phase_name, data in trends.items():
        cpls = data["cpls"]
        data["avg_cpl"] = sum(cpls) / len(cpls) if cpls else None
        data["error_rate"] = (data["blunders"] + data["mistakes"]) / data["moves"] if data["moves"] > 0 else 0
        data["excellence_rate"] = data["excellent"] / data["moves"] if data["moves"] > 0 else 0
    
    return trends


def detect_improvement_signals(
    game_analyses: list[GameDeepAnalysis],
) -> list[dict[str, Any]]:
    """Detect recent improvements in performance."""
    signals: list[dict[str, Any]] = []
    
    if len(game_analyses) < 4:
        return signals
    
    # Compare first half vs second half
    mid = len(game_analyses) // 2
    recent = game_analyses[:mid]  # More recent games
    older = game_analyses[mid:]   # Older games
    
    recent_cpls = [g.avg_cpl for g in recent if g.avg_cpl is not None]
    older_cpls = [g.avg_cpl for g in older if g.avg_cpl is not None]
    
    if recent_cpls and older_cpls:
        recent_avg = sum(recent_cpls) / len(recent_cpls)
        older_avg = sum(older_cpls) / len(older_cpls)
        
        if older_avg > recent_avg * 1.15:  # 15% improvement
            signals.append({
                "type": "overall_accuracy",
                "description": f"Move accuracy improved from {older_avg:.1f} to {recent_avg:.1f} average CPL",
                "magnitude": (older_avg - recent_avg) / older_avg,
            })
    
    # Check time management improvements
    recent_tt = sum(1 for g in recent if g.time_trouble_entered_at is not None)
    older_tt = sum(1 for g in older if g.time_trouble_entered_at is not None)
    
    if older_tt > 0 and recent_tt < older_tt:
        signals.append({
            "type": "time_management",
            "description": f"Time trouble occurrences decreased from {older_tt} to {recent_tt} games",
            "magnitude": (older_tt - recent_tt) / older_tt,
        })
    
    return signals


def detect_regression_signals(
    game_analyses: list[GameDeepAnalysis],
) -> list[dict[str, Any]]:
    """Detect concerning patterns or regressions."""
    signals: list[dict[str, Any]] = []
    
    # Check for blunder clusters
    blunder_heavy_games = [g for g in game_analyses if g.blunders >= 2]
    if len(blunder_heavy_games) >= 3:
        signals.append({
            "type": "blunder_frequency",
            "description": f"{len(blunder_heavy_games)} games with 2+ blunders in recent history",
            "severity": "high",
            "game_ids": [g.game_id for g in blunder_heavy_games],
        })
    
    # Check for opening problems
    opening_phases = [g.phases.get("opening") for g in game_analyses]
    opening_blunders = sum(p.blunders + p.mistakes for p in opening_phases if p)
    if opening_blunders >= 5:
        signals.append({
            "type": "opening_weakness",
            "description": f"{opening_blunders} significant errors in the opening phase across recent games",
            "severity": "medium",
        })
    
    # Check for time trouble correlation with losses
    losses_with_tt = [g for g in game_analyses if g.result == "loss" and g.time_trouble_entered_at is not None]
    if len(losses_with_tt) >= 3:
        signals.append({
            "type": "time_trouble_losses",
            "description": f"{len(losses_with_tt)} losses occurred after entering time trouble",
            "severity": "high",
            "game_ids": [g.game_id for g in losses_with_tt],
        })
    
    return signals


def build_deep_insights(
    db: Session,
    username: str,
    game_limit: int = DEFAULT_GAME_LIMIT,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> DeepInsightsPayload:
    """Build comprehensive deep insights payload."""
    player = get_player(db, username)
    analysis_version = resolve_analysis_version(db, player.id)
    
    # Get recent games
    games = get_recent_games(
        db, player.id, 
        limit=min(game_limit, MAX_GAME_LIMIT),
        date_from=date_from,
        date_to=date_to,
    )
    
    if not games:
        return DeepInsightsPayload(
            player_username=username,
            analysis_version=analysis_version,
            date_range_start=date_from,
            date_range_end=date_to,
            games_analyzed=0,
            overall_stats={},
            game_analyses=[],
            opening_analyses=[],
            time_management=TimeManagementDeepAnalysis(
                avg_time_per_move_ms=None,
                opening_avg_time_ms=None,
                middlegame_avg_time_ms=None,
                endgame_avg_time_ms=None,
                games_with_time_trouble=0,
                total_games=0,
                time_trouble_rate=0,
                avg_ply_entering_time_trouble=None,
                blunders_in_time_trouble=0,
                blunders_total=0,
                time_trouble_blunder_rate=0,
                avg_cpl_fast_moves=None,
                avg_cpl_normal_moves=None,
                avg_cpl_slow_moves=None,
                fastest_blunders=[],
            ),
            phase_trends={},
            improvement_signals=[],
            regression_signals=[],
        )
    
    # Analyze each game
    game_analyses: list[GameDeepAnalysis] = []
    for game in games:
        analysis = analyze_single_game(db, game, username, analysis_version)
        if analysis:
            game_analyses.append(analysis)
    
    # Aggregate analyses
    opening_analyses = analyze_openings(game_analyses)
    time_management = analyze_time_management(game_analyses)
    phase_trends = analyze_phase_trends(game_analyses)
    improvement_signals = detect_improvement_signals(game_analyses)
    regression_signals = detect_regression_signals(game_analyses)
    
    # Calculate overall stats
    wins = sum(1 for g in game_analyses if g.result == "win")
    losses = sum(1 for g in game_analyses if g.result == "loss")
    draws = sum(1 for g in game_analyses if g.result == "draw")
    all_cpls = [g.avg_cpl for g in game_analyses if g.avg_cpl is not None]
    
    overall_stats = {
        "games": len(game_analyses),
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "win_rate": wins / len(game_analyses) if game_analyses else 0,
        "avg_cpl": sum(all_cpls) / len(all_cpls) if all_cpls else None,
        "total_blunders": sum(g.blunders for g in game_analyses),
        "total_mistakes": sum(g.mistakes for g in game_analyses),
        "total_excellent": sum(g.excellent_moves for g in game_analyses),
    }
    
    return DeepInsightsPayload(
        player_username=username,
        analysis_version=analysis_version,
        date_range_start=date_from,
        date_range_end=date_to,
        games_analyzed=len(game_analyses),
        overall_stats=overall_stats,
        game_analyses=game_analyses,
        opening_analyses=opening_analyses,
        time_management=time_management,
        phase_trends=phase_trends,
        improvement_signals=improvement_signals,
        regression_signals=regression_signals,
    )


def convert_to_dict(payload: DeepInsightsPayload) -> dict[str, Any]:
    """Convert DeepInsightsPayload to a dictionary for JSON serialization."""
    def convert_critical_moment(m: CriticalMomentDetail) -> dict:
        return {
            "move_id": m.move_id,
            "game_id": m.game_id,
            "ply": m.ply,
            "move_san": m.move_san,
            "move_uci": m.move_uci,
            "fen_before": m.fen_before,
            "fen_hash": m.fen_hash,
            "classification": m.classification,
            "cpl": m.cpl,
            "best_move_uci": m.best_move_uci,
            "eval_before_cp": m.eval_before_cp,
            "eval_before_mate": m.eval_before_mate,
            "eval_after_cp": m.eval_after_cp,
            "eval_after_mate": m.eval_after_mate,
            "clock_remaining_ms": m.clock_remaining_ms,
            "time_spent_ms": m.time_spent_ms,
            "phase": m.phase,
            "is_tactical": m.is_tactical,
        }
    
    def convert_phase_stats(p: GamePhaseStats) -> dict:
        return {
            "phase": p.phase,
            "moves": p.moves,
            "avg_cpl": p.avg_cpl,
            "blunders": p.blunders,
            "mistakes": p.mistakes,
            "inaccuracies": p.inaccuracies,
            "excellent_moves": p.excellent_moves,
            "avg_time_spent_ms": p.avg_time_spent_ms,
            "time_trouble_moves": p.time_trouble_moves,
        }
    
    def convert_game_analysis(g: GameDeepAnalysis) -> dict:
        return {
            "game_id": g.game_id,
            "result": g.result,
            "player_color": g.player_color,
            "opponent_username": g.opponent_username,
            "opponent_rating": g.opponent_rating,
            "opening": g.opening,
            "time_control": g.time_control,
            "played_at": g.played_at.isoformat() if g.played_at else None,
            "total_moves": g.total_moves,
            "avg_cpl": g.avg_cpl,
            "phases": {k: convert_phase_stats(v) for k, v in g.phases.items()},
            "critical_moments": [convert_critical_moment(m) for m in g.critical_moments],
            "time_trouble_entered_at": g.time_trouble_entered_at,
            "blunders": g.blunders,
            "mistakes": g.mistakes,
            "inaccuracies": g.inaccuracies,
            "excellent_moves": g.excellent_moves,
        }
    
    def convert_opening_analysis(o: OpeningDeepAnalysis) -> dict:
        return {
            "opening_name": o.opening_name,
            "eco_url": o.eco_url,
            "games": o.games,
            "wins": o.wins,
            "losses": o.losses,
            "draws": o.draws,
            "win_rate": o.win_rate,
            "avg_cpl": o.avg_cpl,
            "avg_cpl_opening_phase": o.avg_cpl_opening_phase,
            "common_mistakes": [convert_critical_moment(m) for m in o.common_mistakes],
            "best_games": o.best_games,
            "worst_games": o.worst_games,
        }
    
    def convert_time_management(t: TimeManagementDeepAnalysis) -> dict:
        return {
            "avg_time_per_move_ms": t.avg_time_per_move_ms,
            "opening_avg_time_ms": t.opening_avg_time_ms,
            "middlegame_avg_time_ms": t.middlegame_avg_time_ms,
            "endgame_avg_time_ms": t.endgame_avg_time_ms,
            "games_with_time_trouble": t.games_with_time_trouble,
            "total_games": t.total_games,
            "time_trouble_rate": t.time_trouble_rate,
            "avg_ply_entering_time_trouble": t.avg_ply_entering_time_trouble,
            "blunders_in_time_trouble": t.blunders_in_time_trouble,
            "blunders_total": t.blunders_total,
            "time_trouble_blunder_rate": t.time_trouble_blunder_rate,
            "avg_cpl_fast_moves": t.avg_cpl_fast_moves,
            "avg_cpl_normal_moves": t.avg_cpl_normal_moves,
            "avg_cpl_slow_moves": t.avg_cpl_slow_moves,
            "fastest_blunders": [convert_critical_moment(m) for m in t.fastest_blunders],
        }
    
    return {
        "player_username": payload.player_username,
        "analysis_version": payload.analysis_version,
        "date_range_start": payload.date_range_start.isoformat() if payload.date_range_start else None,
        "date_range_end": payload.date_range_end.isoformat() if payload.date_range_end else None,
        "games_analyzed": payload.games_analyzed,
        "overall_stats": payload.overall_stats,
        "game_analyses": [convert_game_analysis(g) for g in payload.game_analyses],
        "opening_analyses": [convert_opening_analysis(o) for o in payload.opening_analyses],
        "time_management": convert_time_management(payload.time_management),
        "phase_trends": payload.phase_trends,
        "improvement_signals": payload.improvement_signals,
        "regression_signals": payload.regression_signals,
    }

