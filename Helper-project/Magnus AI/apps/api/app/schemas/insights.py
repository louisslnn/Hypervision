from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class InsightsOverviewResponse(BaseModel):
    status: str
    player_username: str
    analysis_version: Optional[str] = None
    games: int
    moves_analyzed: int
    average_cpl: Optional[float] = None
    blunders: int
    mistakes: int
    inaccuracies: int
    last_sync: Optional[datetime] = None


class OpeningInsight(BaseModel):
    opening: str
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    average_cpl: Optional[float] = None


class InsightsOpeningsResponse(BaseModel):
    status: str
    player_username: str
    analysis_version: Optional[str] = None
    openings: list[OpeningInsight]


class InsightsTimeResponse(BaseModel):
    status: str
    player_username: str
    analysis_version: Optional[str] = None
    time_trouble_threshold_ms: int
    avg_time_spent_ms: Optional[float] = None
    time_trouble_moves: int
    time_trouble_blunders: int
    avg_cpl_time_trouble: Optional[float] = None
    avg_cpl_normal: Optional[float] = None


class PatternExampleOut(BaseModel):
    game_id: int
    move_id: int
    fen: str
    notes: Optional[str] = None


class PatternInsight(BaseModel):
    pattern_key: str
    title: str
    description: str
    occurrences: int
    average_cpl: Optional[float] = None
    severity_score: float
    examples: list[PatternExampleOut]


class InsightsPatternsResponse(BaseModel):
    status: str
    player_username: str
    analysis_version: Optional[str] = None
    patterns: list[PatternInsight]


class InsightsCoachGuideline(BaseModel):
    title: str
    description: str
    focus_tags: list[str]
    evidence_game_ids: list[int]
    evidence_move_ids: list[int]


class InsightsCoachReport(BaseModel):
    player_username: str
    analysis_version: Optional[str] = None
    summary: list[str]
    focus_areas: list[str]
    guidelines: list[InsightsCoachGuideline]
    training_plan: list[str]
    limitations: list[str]


class InsightsCoachRequest(BaseModel):
    username: str
    analysis_version: Optional[str] = None
    game_id: Optional[int] = None
    threshold_ms: int = Field(default=30000, ge=1000, le=600000)
    force: bool = False


class InsightsCoachResponse(BaseModel):
    status: str
    scope_type: str
    scope_id: int
    analysis_version: Optional[str] = None
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: InsightsCoachReport
