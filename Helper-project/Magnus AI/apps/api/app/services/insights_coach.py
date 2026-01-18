from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.services.coach import build_game_review_payload
from app.services.insights import (
    build_context,
    get_openings,
    get_overview,
    get_patterns,
    get_time_insights,
)

INSIGHTS_COACH_SYSTEM_PROMPT = (
    "You are a chess coach. Use only the provided JSON payload. "
    "Provide grounded guidance based on the player's analyzed games and cite evidence "
    "using move_id and game_id fields from the payload. "
    "Do not invent moves, evaluations, or positions. "
    "If the payload is missing data, add it to limitations. "
    "Return JSON that matches the provided schema exactly."
)


def build_insights_coach_payload(
    db: Session,
    username: str,
    analysis_version: Optional[str],
    game_id: Optional[int],
    threshold_ms: int = 30000,
) -> tuple[dict[str, Any], Optional[str], int]:
    context = build_context(db, username, analysis_version)
    overview = get_overview(db, context)
    openings = get_openings(db, context)
    time_insights = get_time_insights(db, context, threshold_ms)
    patterns = get_patterns(db, context)

    game_payload = None
    if game_id is not None:
        try:
            game_payload, _ = build_game_review_payload(
                db, game_id, context.analysis_version, max_moments=6
            )
        except ValueError:
            game_payload = None

    payload = {
        "player": {
            "username": context.player.username,
            "analysis_version": context.analysis_version,
        },
        "overview": overview,
        "openings": (openings.get("openings") or [])[:6],
        "time_management": {
            "threshold_ms": time_insights.get("time_trouble_threshold_ms"),
            "avg_time_spent_ms": time_insights.get("avg_time_spent_ms"),
            "time_trouble_moves": time_insights.get("time_trouble_moves"),
            "time_trouble_blunders": time_insights.get("time_trouble_blunders"),
            "avg_cpl_time_trouble": time_insights.get("avg_cpl_time_trouble"),
            "avg_cpl_normal": time_insights.get("avg_cpl_normal"),
        },
        "patterns": (patterns.get("patterns") or [])[:8],
        "game_context": game_payload,
    }

    return payload, context.analysis_version, context.player.id


def build_prompt(payload: dict[str, Any]) -> str:
    payload_json = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    return f"InsightsPayload JSON:\n{payload_json}"
