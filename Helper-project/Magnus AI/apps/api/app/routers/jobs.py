from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.jobs import CoachJobRequest, EngineJobRequest, JobOut
from app.services.jobs import enqueue_coach_job, enqueue_engine_job, get_job

router = APIRouter(tags=["jobs"])


@router.post("/jobs/engine", response_model=JobOut)
def create_engine_job(
    payload: EngineJobRequest,
    db: Session = Depends(get_session),
) -> JobOut:
    job = enqueue_engine_job(
        db,
        game_id=payload.game_id,
        force=payload.force,
        max_plies=payload.max_plies,
        max_attempts=payload.max_attempts,
    )
    return JobOut.model_validate(job)


@router.post("/jobs/coach", response_model=JobOut)
def create_coach_job(
    payload: CoachJobRequest,
    db: Session = Depends(get_session),
) -> JobOut:
    try:
        job = enqueue_coach_job(
            db,
            game_id=payload.game_id,
            question=payload.question,
            analysis_version=payload.analysis_version,
            force=payload.force,
            max_moments=payload.max_moments,
            max_attempts=payload.max_attempts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return JobOut.model_validate(job)


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job_status(job_id: int, db: Session = Depends(get_session)) -> JobOut:
    job = get_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobOut.model_validate(job)
