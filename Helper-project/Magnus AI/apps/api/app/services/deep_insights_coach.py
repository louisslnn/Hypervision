"""
Elite Deep Insights Coach - World Champion Level Chess Analysis.

This module provides LLM-powered coaching insights at the level expected
for elite players and world championship preparation.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from app.services.deep_insights import (
    DeepInsightsPayload,
    convert_to_dict,
)


DEEP_INSIGHTS_SYSTEM_PROMPT = """You are an elite chess coach providing analysis at the highest level of professional chess. Your client is preparing for world championship caliber competition.

## Your Role
You are providing deep, actionable insights based on the last several games. Every observation must be grounded in the provided data. You must think like a top grandmaster analyzing preparation weaknesses.

## Analysis Framework
1. **Pattern Recognition**: Identify recurring errors across games. A single mistake is a moment; repeated patterns are training priorities.
2. **Phase-Specific Analysis**: Separately analyze opening, middlegame, and endgame performance. Elite players need precise phase-by-phase feedback.
3. **Time Management Correlation**: Analyze how time usage affects quality. Note when time pressure leads to errors.
4. **Psychological Patterns**: Infer mental patterns from the data - do errors cluster after advantages? After time trouble? In specific structures?
5. **Comparative Context**: Frame findings relative to elite-level expectations.

## Output Requirements
- Be direct and specific. No generic advice.
- Cite specific games and moves from the payload using game_id and move_id.
- Quantify observations when possible (e.g., "3 of 10 games showed...").
- Prioritize actionable insights over descriptions.
- Distinguish between isolated incidents and systematic patterns.
- For each weakness identified, suggest concrete training approaches.

## Tone
Professional, precise, and demanding. You are coaching someone who expects elite-level analysis. Avoid hedging language unless the data is genuinely inconclusive.

Return JSON matching the provided schema exactly. Do not invent data not present in the payload."""


DEEP_INSIGHTS_USER_PROMPT_TEMPLATE = """Analyze the following deep insights data for {username} covering their last {games_count} games.

Focus on:
1. Overall performance trajectory - improving, declining, or stable?
2. Critical weaknesses that need immediate attention
3. Phase-by-phase performance (opening/middlegame/endgame)
4. Time management patterns and their correlation with errors
5. Opening repertoire performance and recommendations
6. Specific training priorities based on error patterns

DeepInsightsPayload JSON:
{payload_json}"""


def build_deep_insights_prompt(payload: DeepInsightsPayload) -> str:
    """Build the user prompt for deep insights analysis."""
    payload_dict = convert_to_dict(payload)
    payload_json = json.dumps(payload_dict, ensure_ascii=True, separators=(",", ":"))
    
    return DEEP_INSIGHTS_USER_PROMPT_TEMPLATE.format(
        username=payload.player_username,
        games_count=payload.games_analyzed,
        payload_json=payload_json,
    )


def build_deep_insights_hash(
    payload: DeepInsightsPayload,
    model: str,
    prompt_version: str,
    schema_version: str,
) -> str:
    """Build a hash for caching deep insights output."""
    payload_dict = convert_to_dict(payload)
    raw = json.dumps(
        {
            "purpose": "deep_insights",
            "payload": payload_dict,
            "model": model,
            "prompt_version": prompt_version,
            "schema_version": schema_version,
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# Opening-specific coaching prompt
OPENING_INSIGHTS_SYSTEM_PROMPT = """You are an elite chess opening specialist providing analysis for world championship preparation.

## Your Role
Analyze the player's opening repertoire performance based on concrete game data. Your insights should be actionable and specific.

## Analysis Framework
1. **Repertoire Health**: Which openings are performing well vs. poorly?
2. **Error Patterns**: What types of errors occur in each opening? Early deviations, theoretical mistakes, or transition problems?
3. **Structural Understanding**: Infer understanding of resulting structures from the data.
4. **Preparation Gaps**: Where does the player consistently struggle?
5. **Recommendations**: Suggest specific repertoire adjustments.

## Output Requirements
- Rank openings by urgency for training
- Cite specific games and critical moments
- Suggest concrete study material focus areas
- Distinguish between theory knowledge gaps and positional understanding gaps

Return JSON matching the provided schema exactly."""


OPENING_INSIGHTS_USER_PROMPT_TEMPLATE = """Analyze the opening performance for {username} based on their last {games_count} games.

Opening Performance Data:
{opening_json}

Game Details with Opening Phase Analysis:
{games_json}"""


def build_opening_insights_prompt(payload: DeepInsightsPayload) -> str:
    """Build the user prompt for opening-specific analysis."""
    payload_dict = convert_to_dict(payload)
    
    opening_json = json.dumps(payload_dict["opening_analyses"], ensure_ascii=True, separators=(",", ":"))
    
    # Include only relevant game data for openings
    games_data = []
    for game in payload_dict["game_analyses"]:
        games_data.append({
            "game_id": game["game_id"],
            "result": game["result"],
            "opening": game["opening"],
            "opponent_rating": game["opponent_rating"],
            "phases": {"opening": game["phases"].get("opening", {})},
            "critical_moments": [m for m in game["critical_moments"] if m["phase"] == "opening"],
        })
    games_json = json.dumps(games_data, ensure_ascii=True, separators=(",", ":"))
    
    return OPENING_INSIGHTS_USER_PROMPT_TEMPLATE.format(
        username=payload.player_username,
        games_count=payload.games_analyzed,
        opening_json=opening_json,
        games_json=games_json,
    )


# Time management-specific coaching prompt
TIME_INSIGHTS_SYSTEM_PROMPT = """You are an elite chess time management coach analyzing patterns for world championship preparation.

## Your Role
Analyze time usage patterns and their correlation with performance. Time management at the elite level is often the difference between winning and losing critical games.

## Analysis Framework
1. **Phase Distribution**: How is time allocated across opening/middlegame/endgame?
2. **Crisis Points**: When does time trouble typically begin?
3. **Speed vs. Quality**: How do fast moves compare to deliberate moves in quality?
4. **Error Correlation**: Which errors are clearly time-related vs. pure chess errors?
5. **Recommendations**: Specific strategies for time management improvement.

## Output Requirements
- Quantify time patterns precisely
- Identify specific game moments where time management failed
- Suggest concrete time management strategies
- Address both over-thinking and impulsive move patterns

Return JSON matching the provided schema exactly."""


TIME_INSIGHTS_USER_PROMPT_TEMPLATE = """Analyze time management patterns for {username} based on their last {games_count} games.

Time Management Summary:
{time_json}

Game-by-Game Time Data:
{games_json}

Fastest Blunders (moves played too quickly):
{fast_blunders_json}"""


def build_time_insights_prompt(payload: DeepInsightsPayload) -> str:
    """Build the user prompt for time management analysis."""
    payload_dict = convert_to_dict(payload)
    
    time_json = json.dumps(payload_dict["time_management"], ensure_ascii=True, separators=(",", ":"))
    
    # Include time-relevant game data
    games_data = []
    for game in payload_dict["game_analyses"]:
        games_data.append({
            "game_id": game["game_id"],
            "result": game["result"],
            "time_control": game["time_control"],
            "time_trouble_entered_at": game["time_trouble_entered_at"],
            "total_moves": game["total_moves"],
            "phases": {
                phase: {
                    "moves": data.get("moves"),
                    "avg_time_spent_ms": data.get("avg_time_spent_ms"),
                    "time_trouble_moves": data.get("time_trouble_moves"),
                    "blunders": data.get("blunders"),
                }
                for phase, data in game["phases"].items()
            },
            "critical_moments": [
                {
                    "move_id": m["move_id"],
                    "ply": m["ply"],
                    "classification": m["classification"],
                    "cpl": m["cpl"],
                    "clock_remaining_ms": m["clock_remaining_ms"],
                    "time_spent_ms": m["time_spent_ms"],
                    "phase": m["phase"],
                }
                for m in game["critical_moments"]
            ],
        })
    games_json = json.dumps(games_data, ensure_ascii=True, separators=(",", ":"))
    
    fast_blunders_json = json.dumps(
        payload_dict["time_management"]["fastest_blunders"],
        ensure_ascii=True,
        separators=(",", ":"),
    )
    
    return TIME_INSIGHTS_USER_PROMPT_TEMPLATE.format(
        username=payload.player_username,
        games_count=payload.games_analyzed,
        time_json=time_json,
        games_json=games_json,
        fast_blunders_json=fast_blunders_json,
    )

