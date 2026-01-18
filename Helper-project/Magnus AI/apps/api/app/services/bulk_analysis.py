from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.services.engine import StockfishEngineEvaluator, get_engine_config
from app.services.engine_analysis import AnalyzeGameResult, analyze_game


@dataclass(frozen=True)
class AnalyzeAllResult:
    analysis_version: str
    engine_name: str
    engine_version: str
    analysis_depth: int
    analysis_time_ms: int
    analysis_multipv: int
    games_total: int
    games_analyzed: int
    games_skipped: int
    games_failed: int
    moves_analyzed: int
    moves_skipped: int


def analyze_all_games(
    db: Session,
    username: str,
    force: bool = False,
    max_plies: Optional[int] = None,
) -> AnalyzeAllResult:
    normalized = username.strip()
    if not normalized:
        raise ValueError("Username is required.")

    player = (
        db.execute(select(models.Player).where(models.Player.username == normalized))
        .scalars()
        .first()
    )
    if not player:
        raise ValueError("Player not found.")

    games = (
        db.execute(
            select(models.Game)
            .where(models.Game.player_id == player.id)
            .order_by(models.Game.end_time.desc().nulls_last(), models.Game.id.desc())
        )
        .scalars()
        .all()
    )

    config = get_engine_config()
    games_total = len(games)
    games_analyzed = 0
    games_skipped = 0
    games_failed = 0
    moves_analyzed = 0
    moves_skipped = 0

    with StockfishEngineEvaluator(config) as evaluator:
        for game in games:
            if not game.pgn_raw:
                games_skipped += 1
                continue
            try:
                result: AnalyzeGameResult = analyze_game(
                    db,
                    game,
                    evaluator,
                    force=force,
                    max_plies=max_plies,
                )
                db.commit()
            except Exception:
                db.rollback()
                games_failed += 1
                continue

            moves_analyzed += result.moves_analyzed
            moves_skipped += result.moves_skipped
            if result.moves_analyzed > 0:
                games_analyzed += 1
            else:
                games_skipped += 1

        if not evaluator.metadata:
            raise RuntimeError("Engine metadata not available.")

        return AnalyzeAllResult(
            analysis_version=evaluator.metadata.analysis_version,
            engine_name=evaluator.metadata.name,
            engine_version=evaluator.metadata.version,
            analysis_depth=evaluator.metadata.depth,
            analysis_time_ms=evaluator.metadata.time_ms,
            analysis_multipv=evaluator.metadata.multipv,
            games_total=games_total,
            games_analyzed=games_analyzed,
            games_skipped=games_skipped,
            games_failed=games_failed,
            moves_analyzed=moves_analyzed,
            moves_skipped=moves_skipped,
        )
