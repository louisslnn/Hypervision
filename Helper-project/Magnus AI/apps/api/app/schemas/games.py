from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    chesscom_url: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    time_control: Optional[str] = None
    time_class: Optional[str] = None
    rated: Optional[bool] = None
    rules: Optional[str] = None
    white_username: Optional[str] = None
    black_username: Optional[str] = None
    white_rating_post: Optional[int] = None
    black_rating_post: Optional[int] = None
    result_white: Optional[str] = None
    result_black: Optional[str] = None
    eco_url: Optional[str] = None
    created_at: datetime


class MoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    ply: int
    move_san: str
    move_uci: str
    fen_before: str
    fen_after: str
    is_check: bool
    is_mate: bool
    capture_piece: Optional[str] = None
    promotion: Optional[str] = None
    clock_remaining_ms: Optional[int] = None
    time_spent_ms: Optional[int] = None
    created_at: datetime


class GamePgnResponse(BaseModel):
    game_id: int
    pgn: str


class GameParseResponse(BaseModel):
    status: str
    moves_created: int = Field(ge=0)
    moves_existing: int = Field(ge=0)
