from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import COACH_PROMPT_VERSION, COACH_SCHEMA_VERSION
from app.core.logging import correlation_id_ctx, get_logger, request_id_ctx
from app.db import models
from app.schemas.coach import CoachReport
from app.services.coach import (
    COACH_SYSTEM_PROMPT,
    build_coach_prompt,
    build_game_review_payload,
    build_input_hash,
)
from app.services.engine import EngineConfig, StockfishEngineEvaluator, get_engine_config
from app.services.engine_analysis import analyze_game
from app.services.game_parser import get_game_by_id
from app.services.openai_client import OpenAIClient, OpenAIResponseError, get_openai_client

JOB_TYPE_ENGINE = "engine_analysis"
JOB_TYPE_COACH = "coach_report"

JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"

DEFAULT_RETRY_DELAY_SEC = 5

logger = get_logger("app.jobs")


def compute_engine_dedupe_key(game_id: int, max_plies: Optional[int]) -> str:
    return f"engine:{game_id}:max_plies={max_plies or 'all'}"


def compute_coach_dedupe_key(input_hash: str) -> str:
    return f"coach:{input_hash}"


def enqueue_job(
    db: Session,
    job_type: str,
    payload: dict[str, Any],
    dedupe_key: Optional[str],
    max_attempts: int,
) -> models.Job:
    if dedupe_key:
        existing = (
            db.execute(select(models.Job).where(models.Job.dedupe_key == dedupe_key))
            .scalars()
            .first()
        )
        if existing and existing.status in {
            JOB_STATUS_QUEUED,
            JOB_STATUS_RUNNING,
            JOB_STATUS_COMPLETED,
        }:
            return existing

    job = models.Job(
        job_type=job_type,
        status=JOB_STATUS_QUEUED,
        payload_json=payload,
        dedupe_key=dedupe_key,
        max_attempts=max_attempts,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def enqueue_engine_job(
    db: Session,
    game_id: int,
    force: bool,
    max_plies: Optional[int],
    max_attempts: int,
) -> models.Job:
    payload = {"game_id": game_id, "force": force, "max_plies": max_plies}
    dedupe_key = None if force else compute_engine_dedupe_key(game_id, max_plies)
    return enqueue_job(db, JOB_TYPE_ENGINE, payload, dedupe_key, max_attempts)


def enqueue_coach_job(
    db: Session,
    game_id: int,
    question: str,
    analysis_version: Optional[str],
    force: bool,
    max_moments: int,
    max_attempts: int,
) -> models.Job:
    payload = {
        "game_id": game_id,
        "question": question,
        "analysis_version": analysis_version,
        "force": force,
        "max_moments": max_moments,
    }

    review_payload, resolved_version = build_game_review_payload(
        db,
        game_id,
        analysis_version,
        max_moments,
    )
    client = get_openai_client()
    input_hash = build_input_hash(
        question,
        review_payload,
        client.model,
    )
    dedupe_key = None if force else compute_coach_dedupe_key(input_hash)
    payload["analysis_version"] = resolved_version
    payload["input_hash"] = input_hash
    return enqueue_job(db, JOB_TYPE_COACH, payload, dedupe_key, max_attempts)


def get_job(db: Session, job_id: int) -> Optional[models.Job]:
    return db.execute(select(models.Job).where(models.Job.id == job_id)).scalars().first()


def claim_next_job(db: Session) -> Optional[models.Job]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(models.Job)
        .where(
            models.Job.status == JOB_STATUS_QUEUED,
            models.Job.run_at <= now,
        )
        .order_by(models.Job.created_at)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def run_engine_job(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    game_id = int(payload["game_id"])
    force = bool(payload.get("force", False))
    max_plies = payload.get("max_plies")

    game = get_game_by_id(db, game_id)
    if not game:
        raise ValueError("Game not found.")

    config: EngineConfig = get_engine_config()
    with StockfishEngineEvaluator(config) as evaluator:
        result = analyze_game(db, game, evaluator, force=force, max_plies=max_plies)
        db.commit()

    return {
        "analysis_version": result.analysis_version,
        "engine_name": result.engine_name,
        "engine_version": result.engine_version,
        "analysis_depth": result.analysis_depth,
        "analysis_time_ms": result.analysis_time_ms,
        "analysis_multipv": result.analysis_multipv,
        "moves_analyzed": result.moves_analyzed,
        "moves_skipped": result.moves_skipped,
    }


def run_coach_job(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    game_id = int(payload["game_id"])
    question = str(payload["question"])
    analysis_version = payload.get("analysis_version")
    max_moments = int(payload.get("max_moments", 8))
    force = bool(payload.get("force", False))
    input_hash = payload.get("input_hash")

    review_payload, resolved_version = build_game_review_payload(
        db,
        game_id,
        analysis_version,
        max_moments,
    )
    client: OpenAIClient = get_openai_client()
    if not input_hash:
        input_hash = build_input_hash(
            question,
            review_payload,
            client.model,
        )

    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "game",
                models.LlmOutput.scope_id == game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing and not force:
        report = CoachReport.model_validate(existing.output_json)
        return {
            "cached": True,
            "output_id": existing.id,
            "analysis_version": resolved_version,
            "model": existing.model,
            "prompt_version": existing.prompt_version,
            "schema_version": existing.schema_version,
            "report": report.model_dump(),
        }

    prompt = build_coach_prompt(question, review_payload)
    schema = CoachReport.model_json_schema()
    try:
        report_json = client.create_structured_response(
            COACH_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="CoachReport",
        )
    except OpenAIResponseError as exc:
        raise RuntimeError(str(exc)) from exc

    report = CoachReport.model_validate(report_json)
    output = models.LlmOutput(
        scope_type="game",
        scope_id=game_id,
        input_hash=input_hash,
        model=client.model,
        prompt_version=COACH_PROMPT_VERSION,
        schema_version=COACH_SCHEMA_VERSION,
        output_json=report.model_dump(),
    )
    db.add(output)
    db.commit()
    db.refresh(output)
    return {
        "cached": False,
        "output_id": output.id,
        "analysis_version": resolved_version,
        "model": output.model,
        "prompt_version": output.prompt_version,
        "schema_version": output.schema_version,
        "report": report.model_dump(),
    }


def execute_job(db: Session, job: models.Job) -> models.Job:
    if job.status != JOB_STATUS_QUEUED:
        return job

    job.status = JOB_STATUS_RUNNING
    job.started_at = datetime.now(timezone.utc)
    job.attempts = (job.attempts or 0) + 1
    db.commit()
    db.refresh(job)

    token_request = request_id_ctx.set(f"job-{job.id}")
    token_correlation = correlation_id_ctx.set(f"job-{job.id}")
    try:
        logger.info(
            "job.start",
            extra={"event": "job.start", "job_id": job.id, "job_type": job.job_type},
        )
        if job.job_type == JOB_TYPE_ENGINE:
            result = run_engine_job(db, job.payload_json)
        elif job.job_type == JOB_TYPE_COACH:
            result = run_coach_job(db, job.payload_json)
        else:
            raise ValueError(f"Unknown job type: {job.job_type}")

        job.status = JOB_STATUS_COMPLETED
        job.result_json = result
        job.error_message = None
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(job)
        logger.info(
            "job.complete",
            extra={"event": "job.complete", "job_id": job.id, "job_type": job.job_type},
        )
        return job
    except Exception as exc:
        job.error_message = str(exc)
        if job.attempts >= job.max_attempts:
            job.status = JOB_STATUS_FAILED
            job.finished_at = datetime.now(timezone.utc)
        else:
            job.status = JOB_STATUS_QUEUED
            job.run_at = datetime.now(timezone.utc) + timedelta(seconds=DEFAULT_RETRY_DELAY_SEC)
        db.commit()
        db.refresh(job)
        logger.error(
            "job.failed",
            extra={
                "event": "job.failed",
                "job_id": job.id,
                "job_type": job.job_type,
                "error_message": job.error_message,
            },
        )
        return job
    finally:
        request_id_ctx.reset(token_request)
        correlation_id_ctx.reset(token_correlation)


def process_pending_jobs(db: Session, limit: int = 1) -> list[models.Job]:
    processed: list[models.Job] = []
    for _ in range(limit):
        job = claim_next_job(db)
        if not job:
            break
        processed.append(execute_job(db, job))
    return processed
