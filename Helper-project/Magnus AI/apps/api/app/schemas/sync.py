from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SyncRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class SyncRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: Literal["running", "completed", "failed", "stub"]
    player_username: Optional[str] = None
    sync_version: str
    archives_total: int
    months_fetched: int
    months_not_modified: int
    games_upserted: int
    games_skipped: int
    error_message: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None


class SyncStatusResponse(BaseModel):
    status: str
    last_run: Optional[SyncRunOut]
