from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import COACH_PROMPT_VERSION, COACH_SCHEMA_VERSION
from app.db import models
from app.db.session import get_session
from app.schemas.coach import CoachQueryRequest, CoachQueryResponse, CoachReport
from app.services.coach import (
    COACH_SYSTEM_PROMPT,
    build_coach_prompt,
    build_game_review_payload,
    build_input_hash,
)
from app.services.openai_client import OpenAIClient, OpenAIResponseError, get_openai_client

router = APIRouter(tags=["coach"])


@router.post("/coach/query", response_model=CoachQueryResponse)
def coach_query(
    payload: CoachQueryRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> CoachQueryResponse:
    if payload.game_id is None:
        raise HTTPException(status_code=400, detail="game_id is required for coach queries.")

    try:
        review_payload, resolved_version = build_game_review_payload(
            db,
            payload.game_id,
            payload.analysis_version,
            payload.max_moments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_hash = build_input_hash(
        payload.question,
        review_payload,
        client.model,
        prompt_version=COACH_PROMPT_VERSION,
        schema_version=COACH_SCHEMA_VERSION,
    )

    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "game",
                models.LlmOutput.scope_id == payload.game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing and not payload.force:
        report = CoachReport.model_validate(existing.output_json)
        return CoachQueryResponse(
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

    prompt = build_coach_prompt(payload.question, review_payload)
    schema = CoachReport.model_json_schema()
    try:
        report_json = client.create_structured_response(
            COACH_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="CoachReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    report = CoachReport.model_validate(report_json)
    output = models.LlmOutput(
        scope_type="game",
        scope_id=payload.game_id,
        input_hash=input_hash,
        model=client.model,
        prompt_version=COACH_PROMPT_VERSION,
        schema_version=COACH_SCHEMA_VERSION,
        output_json=report.model_dump(),
    )
    db.add(output)
    db.commit()
    db.refresh(output)

    return CoachQueryResponse(
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
