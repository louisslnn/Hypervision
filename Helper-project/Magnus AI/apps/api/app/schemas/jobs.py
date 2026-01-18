from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class EngineJobRequest(BaseModel):
    game_id: int
    force: bool = False
    max_plies: Optional[int] = Field(default=None, ge=1)
    max_attempts: int = Field(default=3, ge=1, le=10)


class CoachJobRequest(BaseModel):
    game_id: int
    question: str
    analysis_version: Optional[str] = None
    force: bool = False
    max_moments: int = Field(default=8, ge=1, le=20)
    max_attempts: int = Field(default=3, ge=1, le=10)


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_type: str
    status: str
    attempts: int
    max_attempts: int
    payload_json: dict[str, Any]
    result_json: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    run_at: datetime
    dedupe_key: Optional[str] = None
