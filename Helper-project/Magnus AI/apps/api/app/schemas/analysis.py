from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class EvaluationOut(BaseModel):
    eval_cp: Optional[int] = None
    eval_mate: Optional[int] = None


class AnalyzeGameRequest(BaseModel):
    force: bool = False
    max_plies: Optional[int] = Field(default=None, ge=1)


class AnalyzeGameResponse(BaseModel):
    status: str
    analysis_version: str
    engine_name: str
    engine_version: str
    analysis_depth: int
    analysis_time_ms: int
    analysis_multipv: int
    moves_analyzed: int
    moves_skipped: int


class AnalyzeAllRequest(BaseModel):
    username: str
    force: bool = False
    max_plies: Optional[int] = Field(default=None, ge=1)


class AnalyzeAllResponse(BaseModel):
    status: str
    player_username: str
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


class CriticalMomentOut(BaseModel):
    move_id: int
    ply: int
    move_san: str
    fen_before: str
    cpl: Optional[int] = None
    classification: str
    best_move_uci: Optional[str] = None
    eval_before: EvaluationOut
    eval_after: EvaluationOut


class GameAnalysisResponse(BaseModel):
    status: str
    analysis_version: str
    engine_name: str
    engine_version: str
    analysis_depth: int
    analysis_time_ms: int
    analysis_multipv: int
    move_count: int
    critical_moments: list[CriticalMomentOut]


class MoveAnalysisOut(BaseModel):
    id: int
    move_id: int
    analysis_version: str
    eval_before: EvaluationOut
    eval_after: EvaluationOut
    cpl: Optional[int] = None
    best_move_uci: Optional[str] = None
    best_eval: EvaluationOut
    classification: str
    tags: list[str] = Field(default_factory=list)
    created_at: datetime


class AnalysisSeriesPoint(BaseModel):
    move_id: int
    ply: int
    move_san: str
    move_uci: str
    fen_before: str
    fen_after: str
    eval_before: EvaluationOut
    eval_after: EvaluationOut
    cpl: Optional[int] = None
    classification: str
    best_move_uci: Optional[str] = None
    clock_remaining_ms: Optional[int] = None
    time_spent_ms: Optional[int] = None


class GameAnalysisSeriesResponse(BaseModel):
    status: str
    analysis_version: str
    series: list[AnalysisSeriesPoint]
