from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.schemas.privacy import DataPurgeResponse

router = APIRouter(tags=["privacy"])


@router.delete("/data/purge", response_model=DataPurgeResponse)
def purge_data(db: Session = Depends(get_session)) -> DataPurgeResponse:
    deleted = {
        "jobs": db.query(models.Job).delete(),
        "pattern_examples": db.query(models.PatternExample).delete(),
        "patterns": db.query(models.Pattern).delete(),
        "move_analysis": db.query(models.MoveAnalysis).delete(),
        "engine_positions": db.query(models.EnginePosition).delete(),
        "moves": db.query(models.Move).delete(),
        "games": db.query(models.Game).delete(),
        "raw_ingest": db.query(models.RawIngest).delete(),
        "sync_runs": db.query(models.SyncRun).delete(),
        "llm_outputs": db.query(models.LlmOutput).delete(),
        "players": db.query(models.Player).delete(),
    }
    db.commit()
    return DataPurgeResponse(status="ok", deleted=deleted)
