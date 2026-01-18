from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import INSIGHTS_COACH_PROMPT_VERSION, INSIGHTS_COACH_SCHEMA_VERSION
from app.db import models
from app.db.session import get_session
from app.schemas.insights import (
    InsightsCoachReport,
    InsightsCoachRequest,
    InsightsCoachResponse,
    InsightsOpeningsResponse,
    InsightsOverviewResponse,
    InsightsPatternsResponse,
    InsightsTimeResponse,
)
from app.services.insights import (
    build_context,
    get_openings,
    get_overview,
    get_patterns,
    get_time_insights,
)
from app.services.insights_coach import (
    INSIGHTS_COACH_SYSTEM_PROMPT,
    build_insights_coach_payload,
    build_prompt,
)
from app.services.move_coach import build_input_hash
from app.services.openai_client import OpenAIClient, OpenAIResponseError, get_openai_client

router = APIRouter(tags=["insights"])


@router.get("/insights/overview", response_model=InsightsOverviewResponse)
def insights_overview(
    username: str = Query(..., min_length=1),
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
) -> InsightsOverviewResponse:
    try:
        context = build_context(db, username, analysis_version)
        payload = get_overview(db, context)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InsightsOverviewResponse(status="ok", **payload)


@router.get("/insights/openings", response_model=InsightsOpeningsResponse)
def insights_openings(
    username: str = Query(..., min_length=1),
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
) -> InsightsOpeningsResponse:
    try:
        context = build_context(db, username, analysis_version)
        payload = get_openings(db, context)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InsightsOpeningsResponse(status="ok", **payload)


@router.get("/insights/time", response_model=InsightsTimeResponse)
def insights_time(
    username: str = Query(..., min_length=1),
    analysis_version: str | None = None,
    threshold_ms: int = Query(default=30000, ge=1000, le=600000),
    db: Session = Depends(get_session),
) -> InsightsTimeResponse:
    try:
        context = build_context(db, username, analysis_version)
        payload = get_time_insights(db, context, threshold_ms)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InsightsTimeResponse(status="ok", **payload)


@router.get("/insights/patterns", response_model=InsightsPatternsResponse)
def insights_patterns(
    username: str = Query(..., min_length=1),
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
) -> InsightsPatternsResponse:
    try:
        context = build_context(db, username, analysis_version)
        payload = get_patterns(db, context)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InsightsPatternsResponse(status="ok", **payload)


@router.get("/insights/coach", response_model=InsightsCoachResponse)
def get_insights_coach(
    username: str = Query(..., min_length=1),
    analysis_version: str | None = None,
    game_id: int | None = None,
    threshold_ms: int = Query(default=30000, ge=1000, le=600000),
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> InsightsCoachResponse:
    try:
        coach_payload, resolved_version, player_id = build_insights_coach_payload(
            db, username, analysis_version, game_id, threshold_ms
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    input_hash = build_input_hash(
        "insights_coach",
        coach_payload,
        client.model,
        prompt_version=INSIGHTS_COACH_PROMPT_VERSION,
        schema_version=INSIGHTS_COACH_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "insights_coach",
                models.LlmOutput.scope_id == player_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Insights coach report not found.")

    report = InsightsCoachReport.model_validate(existing.output_json)
    return InsightsCoachResponse(
        status="ok",
        scope_type=existing.scope_type,
        scope_id=existing.scope_id,
        analysis_version=resolved_version,
        model=existing.model,
        prompt_version=existing.prompt_version,
        schema_version=existing.schema_version,
        output_id=existing.id,
        cached=True,
        created_at=existing.created_at,
        report=report,
    )


@router.post("/insights/coach", response_model=InsightsCoachResponse)
def insights_coach(
    payload: InsightsCoachRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> InsightsCoachResponse:
    try:
        coach_payload, resolved_version, player_id = build_insights_coach_payload(
            db,
            payload.username,
            payload.analysis_version,
            payload.game_id,
            payload.threshold_ms,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    input_hash = build_input_hash(
        "insights_coach",
        coach_payload,
        client.model,
        prompt_version=INSIGHTS_COACH_PROMPT_VERSION,
        schema_version=INSIGHTS_COACH_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "insights_coach",
                models.LlmOutput.scope_id == player_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing and not payload.force:
        report = InsightsCoachReport.model_validate(existing.output_json)
        return InsightsCoachResponse(
            status="ok",
            scope_type=existing.scope_type,
            scope_id=existing.scope_id,
            analysis_version=resolved_version,
            model=existing.model,
            prompt_version=existing.prompt_version,
            schema_version=existing.schema_version,
            output_id=existing.id,
            cached=True,
            created_at=existing.created_at,
            report=report,
        )

    prompt = build_prompt(coach_payload)
    schema = InsightsCoachReport.model_json_schema()
    try:
        report_json = client.create_structured_response(
            INSIGHTS_COACH_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="InsightsCoachReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    report = InsightsCoachReport.model_validate(report_json)
    if existing:
        existing.model = client.model
        existing.prompt_version = INSIGHTS_COACH_PROMPT_VERSION
        existing.schema_version = INSIGHTS_COACH_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="insights_coach",
            scope_id=player_id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=INSIGHTS_COACH_PROMPT_VERSION,
            schema_version=INSIGHTS_COACH_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)

    db.commit()
    db.refresh(output)

    return InsightsCoachResponse(
        status="ok",
        scope_type=output.scope_type,
        scope_id=output.scope_id,
        analysis_version=resolved_version,
        model=output.model,
        prompt_version=output.prompt_version,
        schema_version=output.schema_version,
        output_id=output.id,
        cached=False,
        created_at=output.created_at,
        report=report,
    )
