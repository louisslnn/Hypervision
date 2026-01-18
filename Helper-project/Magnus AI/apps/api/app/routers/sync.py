from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.schemas.sync import SyncRequest, SyncRunOut, SyncStatusResponse
from app.services.chesscom import ChesscomClient, get_chesscom_client
from app.services.sync import run_sync

router = APIRouter(tags=["sync"])


@router.post("/sync", response_model=SyncRunOut)
def sync_games(
    payload: SyncRequest,
    db: Session = Depends(get_session),
    client: ChesscomClient = Depends(get_chesscom_client),
) -> SyncRunOut:
    try:
        run = run_sync(db, payload.username, client)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SyncRunOut.model_validate(run)


@router.get("/sync/status", response_model=SyncStatusResponse)
def sync_status(db: Session = Depends(get_session)) -> SyncStatusResponse:
    stmt = select(models.SyncRun).order_by(desc(models.SyncRun.created_at))
    last_run = db.execute(stmt).scalars().first()
    last_run_out = SyncRunOut.model_validate(last_run) if last_run else None
    return SyncStatusResponse(status="ok", last_run=last_run_out)
