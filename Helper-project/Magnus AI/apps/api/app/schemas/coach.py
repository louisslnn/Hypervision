from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CoachPhaseAdvice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    opening: list[str]
    middlegame: list[str]
    endgame: list[str]


class CoachEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    best_move_uci: Optional[str] = None
    eval_before_cp: Optional[int] = None
    eval_before_mate: Optional[int] = None
    eval_after_cp: Optional[int] = None
    eval_after_mate: Optional[int] = None


class CoachCriticalMoment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    move_id: int
    ply: int
    fen_hash: str
    move_san: str
    classification: str
    cpl: Optional[int] = None
    explanation: str
    evidence: CoachEvidence
    what_to_train: list[str] = Field(default_factory=list)


class CoachTrainingItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    description: str
    focus_tags: list[str]
    related_move_ids: list[int]
    time_estimate_min: int


class CoachReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: list[str]
    phase_advice: CoachPhaseAdvice
    critical_moments: list[CoachCriticalMoment]
    themes: list[str]
    training_plan: list[CoachTrainingItem]
    limitations: list[str]


class CoachQueryRequest(BaseModel):
    question: str
    game_id: Optional[int] = None
    analysis_version: Optional[str] = None
    force: bool = False
    max_moments: int = Field(default=8, ge=1, le=20)


class CoachQueryResponse(BaseModel):
    status: str
    scope_type: str
    scope_id: int
    analysis_version: str
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: CoachReport


class MoveCommentaryEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    best_move_uci: Optional[str] = None
    eval_before_cp: Optional[int] = None
    eval_before_mate: Optional[int] = None
    eval_after_cp: Optional[int] = None
    eval_after_mate: Optional[int] = None


class MoveCommentary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    move_id: int
    ply: int
    move_san: str
    move_uci: str
    fen_hash: str
    classification: str
    cpl: Optional[int] = None
    clock_remaining_ms: Optional[int] = None
    time_spent_ms: Optional[int] = None
    explanation: str
    best_move_explanation: Optional[str] = None
    focus_tags: list[str]
    evidence: MoveCommentaryEvidence


class MoveCommentaryReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_id: int
    analysis_version: str
    summary: list[str]
    themes: list[str]
    moves: list[MoveCommentary]
    limitations: list[str]


class CommentaryWizardSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text", "move"]
    text: Optional[str] = None
    san: Optional[str] = None

    @model_validator(mode="after")
    def validate_segment(self) -> "CommentaryWizardSegment":
        if self.type == "text" and not self.text:
            raise ValueError("text segment requires text")
        if self.type == "move" and not self.san:
            raise ValueError("move segment requires san")
        return self


class CommentaryWizardReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_id: int
    move_id: int
    analysis_version: str
    question: str
    segments: list[CommentaryWizardSegment]
    limitations: list[str]


class GameRecapMoment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    move_id: int
    ply: int
    move_san: str
    classification: str
    cpl: Optional[int] = None
    explanation: str
    evidence: MoveCommentaryEvidence


class GameRecapReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_id: int
    analysis_version: str
    summary: list[str]
    key_moments: list[GameRecapMoment]
    strengths: list[str]
    weaknesses: list[str]
    training_focus: list[str]
    limitations: list[str]


class MoveCommentaryRequest(BaseModel):
    analysis_version: Optional[str] = None
    force: bool = False


class MoveCommentaryResponse(BaseModel):
    status: str
    scope_type: str
    scope_id: int
    analysis_version: str
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: MoveCommentaryReport


class GameRecapRequest(BaseModel):
    analysis_version: Optional[str] = None
    force: bool = False


class GameRecapResponse(BaseModel):
    status: str
    scope_type: str
    scope_id: int
    analysis_version: str
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: GameRecapReport


class CommentaryWizardRequest(BaseModel):
    question: str
    move_id: int
    analysis_version: Optional[str] = None
    force: bool = False


class CommentaryWizardResponse(BaseModel):
    status: str
    scope_type: str
    scope_id: int
    analysis_version: str
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: CommentaryWizardReport
