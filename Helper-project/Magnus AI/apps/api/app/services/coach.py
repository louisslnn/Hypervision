import hashlib
import json
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import COACH_PROMPT_VERSION, COACH_SCHEMA_VERSION
from app.db import models
from app.services.engine import hash_fen
from app.services.engine_analysis import get_engine_metadata, get_game_analysis_rows

COACH_SYSTEM_PROMPT = (
    "You are a chess coach. Use only the provided JSON payload. "
    "Do not invent moves, evaluations, or positions. "
    "Every claim must be supported by payload fields and must cite move_id + fen_hash. "
    "If the payload is missing data, add it to limitations. "
    "Return JSON that matches the provided schema exactly."
)


def build_game_review_payload(
    db: Session,
    game_id: int,
    analysis_version: Optional[str],
    max_moments: int,
) -> tuple[dict[str, Any], str]:
    game = db.execute(select(models.Game).where(models.Game.id == game_id)).scalars().first()
    if not game:
        raise ValueError("Game not found.")

    player = (
        db.execute(select(models.Player).where(models.Player.id == game.player_id))
        .scalars()
        .first()
    )
    player_username = player.username if player else None

    player_color = None
    opponent_username = None
    if player_username and game.white_username == player_username:
        player_color = "white"
        opponent_username = game.black_username
    elif player_username and game.black_username == player_username:
        player_color = "black"
        opponent_username = game.white_username

    resolved_version, rows = get_game_analysis_rows(db, game_id, analysis_version)
    if not resolved_version:
        raise ValueError("Engine analysis not found for game.")

    metadata = get_engine_metadata(db, resolved_version)

    critical_rows = [row for row in rows if row[0].cpl is not None]
    critical_rows.sort(key=lambda item: item[0].cpl or 0, reverse=True)
    critical_rows = critical_rows[:max_moments]

    moments: list[dict[str, Any]] = []
    for analysis, move in critical_rows:
        fen_hash = hash_fen(move.fen_before)
        moments.append(
            {
                "move_id": move.id,
                "ply": move.ply,
                "move_san": move.move_san,
                "move_uci": move.move_uci,
                "fen_before": move.fen_before,
                "fen_hash": fen_hash,
                "classification": analysis.classification,
                "cpl": analysis.cpl,
                "best_move_uci": analysis.best_move_uci,
                "eval_before_cp": analysis.eval_before_cp,
                "eval_before_mate": analysis.eval_before_mate,
                "eval_after_cp": analysis.eval_after_cp,
                "eval_after_mate": analysis.eval_after_mate,
                "clock_remaining_ms": move.clock_remaining_ms,
                "time_spent_ms": move.time_spent_ms,
            }
        )

    payload = {
        "game": {
            "id": game.id,
            "player_username": player_username,
            "player_color": player_color,
            "opponent_username": opponent_username,
            "white_username": game.white_username,
            "black_username": game.black_username,
            "white_rating_post": game.white_rating_post,
            "black_rating_post": game.black_rating_post,
            "result_white": game.result_white,
            "result_black": game.result_black,
            "time_control": game.time_control,
            "time_class": game.time_class,
            "rated": game.rated,
            "rules": game.rules,
            "eco_url": game.eco_url,
            "start_time": game.start_time.isoformat() if game.start_time else None,
            "end_time": game.end_time.isoformat() if game.end_time else None,
        },
        "analysis": {
            "analysis_version": resolved_version,
            "engine_name": metadata.name if metadata else "unknown",
            "engine_version": metadata.version if metadata else "unknown",
            "analysis_depth": metadata.depth if metadata else 0,
            "analysis_time_ms": metadata.time_ms if metadata else 0,
            "analysis_multipv": metadata.multipv if metadata else 1,
        },
        "critical_moments": moments,
    }

    return payload, resolved_version


def build_coach_prompt(question: str, payload: dict[str, Any]) -> str:
    payload_json = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    return f"Question: {question}\n\nGameReviewPayload JSON:\n{payload_json}"


def build_input_hash(
    question: str,
    payload: dict[str, Any],
    model: str,
    prompt_version: str = COACH_PROMPT_VERSION,
    schema_version: str = COACH_SCHEMA_VERSION,
) -> str:
    raw = json.dumps(
        {
            "question": question,
            "payload": payload,
            "model": model,
            "prompt_version": prompt_version,
            "schema_version": schema_version,
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
