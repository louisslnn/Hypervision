"""
Deep Insights API Router - Elite Level Chess Analysis.

Provides endpoints for comprehensive analysis of recent games
with LLM-powered coaching insights at world champion level.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import (
    DEEP_INSIGHTS_PROMPT_VERSION,
    DEEP_INSIGHTS_SCHEMA_VERSION,
    DEFAULT_DEEP_INSIGHTS_GAMES,
    MAX_DEEP_INSIGHTS_GAMES,
    OPENING_INSIGHTS_PROMPT_VERSION,
    OPENING_INSIGHTS_SCHEMA_VERSION,
    TIME_INSIGHTS_PROMPT_VERSION,
    TIME_INSIGHTS_SCHEMA_VERSION,
)
from app.db import models
from app.db.session import get_session
from app.schemas.deep_insights import (
    CriticalMomentOut,
    DeepInsightsCoachReport,
    DeepInsightsCoachResponse,
    DeepInsightsDataResponse,
    DeepInsightsRequest,
    GameByGameInsightOut,
    GameDeepAnalysisOut,
    OpeningDeepAnalysisOut,
    OpeningInsightsCoachReport,
    OpeningInsightsCoachResponse,
    OpeningInsightsRequest,
    OpeningRecommendationOut,
    OverallStatsOut,
    PhaseAnalysisOut,
    PhaseStatsOut,
    PhaseTrendOut,
    SignalOut,
    TimeInsightsCoachReport,
    TimeInsightsCoachResponse,
    TimeInsightsRequest,
    TimeManagementDeepAnalysisOut,
    TimeStrategyRecommendationOut,
    TrainingPriorityOut,
)
from app.services.deep_insights import (
    build_deep_insights,
    convert_to_dict,
)
from app.services.deep_insights_coach import (
    DEEP_INSIGHTS_SYSTEM_PROMPT,
    OPENING_INSIGHTS_SYSTEM_PROMPT,
    TIME_INSIGHTS_SYSTEM_PROMPT,
    build_deep_insights_hash,
    build_deep_insights_prompt,
    build_opening_insights_prompt,
    build_time_insights_prompt,
)
from app.services.insights import get_player
from app.services.move_coach import build_input_hash
from app.services.openai_client import OpenAIClient, OpenAIResponseError, get_openai_client

router = APIRouter(tags=["deep-insights"])


def convert_critical_moment(data: dict) -> CriticalMomentOut:
    """Convert critical moment dict to schema."""
    return CriticalMomentOut(**data)


def convert_phase_stats(data: dict) -> PhaseStatsOut:
    """Convert phase stats dict to schema."""
    return PhaseStatsOut(**data)


def convert_game_analysis(data: dict) -> GameDeepAnalysisOut:
    """Convert game analysis dict to schema."""
    phases = {k: convert_phase_stats(v) for k, v in data["phases"].items()}
    critical_moments = [convert_critical_moment(m) for m in data["critical_moments"]]
    
    played_at = None
    if data.get("played_at"):
        if isinstance(data["played_at"], str):
            played_at = datetime.fromisoformat(data["played_at"])
        else:
            played_at = data["played_at"]
    
    return GameDeepAnalysisOut(
        game_id=data["game_id"],
        result=data["result"],
        player_color=data["player_color"],
        opponent_username=data.get("opponent_username"),
        opponent_rating=data.get("opponent_rating"),
        opening=data.get("opening"),
        time_control=data.get("time_control"),
        played_at=played_at,
        total_moves=data["total_moves"],
        avg_cpl=data.get("avg_cpl"),
        phases=phases,
        critical_moments=critical_moments,
        time_trouble_entered_at=data.get("time_trouble_entered_at"),
        blunders=data["blunders"],
        mistakes=data["mistakes"],
        inaccuracies=data["inaccuracies"],
        excellent_moves=data["excellent_moves"],
    )


def convert_opening_analysis(data: dict) -> OpeningDeepAnalysisOut:
    """Convert opening analysis dict to schema."""
    return OpeningDeepAnalysisOut(
        opening_name=data["opening_name"],
        eco_url=data.get("eco_url"),
        games=data["games"],
        wins=data["wins"],
        losses=data["losses"],
        draws=data["draws"],
        win_rate=data["win_rate"],
        avg_cpl=data.get("avg_cpl"),
        avg_cpl_opening_phase=data.get("avg_cpl_opening_phase"),
        common_mistakes=[convert_critical_moment(m) for m in data.get("common_mistakes", [])],
        best_games=data.get("best_games", []),
        worst_games=data.get("worst_games", []),
    )


def convert_time_management(data: dict) -> TimeManagementDeepAnalysisOut:
    """Convert time management dict to schema."""
    return TimeManagementDeepAnalysisOut(
        avg_time_per_move_ms=data.get("avg_time_per_move_ms"),
        opening_avg_time_ms=data.get("opening_avg_time_ms"),
        middlegame_avg_time_ms=data.get("middlegame_avg_time_ms"),
        endgame_avg_time_ms=data.get("endgame_avg_time_ms"),
        games_with_time_trouble=data["games_with_time_trouble"],
        total_games=data["total_games"],
        time_trouble_rate=data["time_trouble_rate"],
        avg_ply_entering_time_trouble=data.get("avg_ply_entering_time_trouble"),
        blunders_in_time_trouble=data["blunders_in_time_trouble"],
        blunders_total=data["blunders_total"],
        time_trouble_blunder_rate=data["time_trouble_blunder_rate"],
        avg_cpl_fast_moves=data.get("avg_cpl_fast_moves"),
        avg_cpl_normal_moves=data.get("avg_cpl_normal_moves"),
        avg_cpl_slow_moves=data.get("avg_cpl_slow_moves"),
        fastest_blunders=[convert_critical_moment(m) for m in data.get("fastest_blunders", [])],
    )


@router.get("/deep-insights/data", response_model=DeepInsightsDataResponse)
def get_deep_insights_data(
    username: str = Query(..., min_length=1),
    game_limit: int = Query(default=DEFAULT_DEEP_INSIGHTS_GAMES, ge=1, le=MAX_DEEP_INSIGHTS_GAMES),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_session),
) -> DeepInsightsDataResponse:
    """
    Get raw deep insights data for a player.
    
    This endpoint returns comprehensive analysis data without LLM interpretation.
    Use this for custom UI rendering or when you want the raw data.
    """
    try:
        payload = build_deep_insights(
            db,
            username,
            game_limit=game_limit,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    payload_dict = convert_to_dict(payload)
    
    # Convert to response schema
    game_analyses = [convert_game_analysis(g) for g in payload_dict["game_analyses"]]
    opening_analyses = [convert_opening_analysis(o) for o in payload_dict["opening_analyses"]]
    time_management = convert_time_management(payload_dict["time_management"])
    
    phase_trends = {}
    for phase, data in payload_dict["phase_trends"].items():
        phase_trends[phase] = PhaseTrendOut(
            avg_cpl=data.get("avg_cpl"),
            blunders=data.get("blunders", 0),
            mistakes=data.get("mistakes", 0),
            excellent=data.get("excellent", 0),
            moves=data.get("moves", 0),
            error_rate=data.get("error_rate", 0),
            excellence_rate=data.get("excellence_rate", 0),
        )
    
    improvement_signals = [SignalOut(**s) for s in payload_dict["improvement_signals"]]
    regression_signals = [SignalOut(**s) for s in payload_dict["regression_signals"]]
    
    overall_stats = OverallStatsOut(**payload_dict["overall_stats"])
    
    return DeepInsightsDataResponse(
        status="ok",
        player_username=payload.player_username,
        analysis_version=payload.analysis_version,
        date_range_start=payload.date_range_start,
        date_range_end=payload.date_range_end,
        games_analyzed=payload.games_analyzed,
        overall_stats=overall_stats,
        game_analyses=game_analyses,
        opening_analyses=opening_analyses,
        time_management=time_management,
        phase_trends=phase_trends,
        improvement_signals=improvement_signals,
        regression_signals=regression_signals,
    )


@router.get("/deep-insights/coach", response_model=DeepInsightsCoachResponse)
def get_deep_insights_coach(
    username: str = Query(..., min_length=1),
    game_limit: int = Query(default=DEFAULT_DEEP_INSIGHTS_GAMES, ge=1, le=MAX_DEEP_INSIGHTS_GAMES),
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> DeepInsightsCoachResponse:
    """
    Get cached deep insights coaching report.
    
    Returns 404 if no cached report exists. Use POST to generate.
    """
    try:
        player = get_player(db, username)
        payload = build_deep_insights(db, username, game_limit=game_limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    if payload.games_analyzed == 0:
        raise HTTPException(status_code=404, detail="No analyzed games found.")
    
    input_hash = build_deep_insights_hash(
        payload,
        client.model,
        prompt_version=DEEP_INSIGHTS_PROMPT_VERSION,
        schema_version=DEEP_INSIGHTS_SCHEMA_VERSION,
    )
    
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "deep_insights",
                models.LlmOutput.scope_id == player.id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    
    if not existing:
        raise HTTPException(status_code=404, detail="Deep insights report not found. Use POST to generate.")
    
    report = DeepInsightsCoachReport.model_validate(existing.output_json)
    return DeepInsightsCoachResponse(
        status="ok",
        scope_type=existing.scope_type,
        scope_id=existing.scope_id,
        analysis_version=payload.analysis_version,
        model=existing.model,
        prompt_version=existing.prompt_version,
        schema_version=existing.schema_version,
        output_id=existing.id,
        cached=True,
        created_at=existing.created_at,
        report=report,
    )


@router.post("/deep-insights/coach", response_model=DeepInsightsCoachResponse)
def generate_deep_insights_coach(
    payload: DeepInsightsRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> DeepInsightsCoachResponse:
    """
    Generate elite-level deep insights coaching report.
    
    This uses LLM to analyze the last N games and provide world champion-level
    coaching insights with specific training recommendations.
    """
    try:
        player = get_player(db, payload.username)
        insights_payload = build_deep_insights(
            db,
            payload.username,
            game_limit=payload.game_limit,
            date_from=payload.date_from,
            date_to=payload.date_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    if insights_payload.games_analyzed == 0:
        raise HTTPException(status_code=400, detail="No analyzed games found. Run engine analysis first.")
    
    input_hash = build_deep_insights_hash(
        insights_payload,
        client.model,
        prompt_version=DEEP_INSIGHTS_PROMPT_VERSION,
        schema_version=DEEP_INSIGHTS_SCHEMA_VERSION,
    )
    
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "deep_insights",
                models.LlmOutput.scope_id == player.id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    
    if existing and not payload.force:
        report = DeepInsightsCoachReport.model_validate(existing.output_json)
        return DeepInsightsCoachResponse(
            status="ok",
            scope_type=existing.scope_type,
            scope_id=existing.scope_id,
            analysis_version=insights_payload.analysis_version,
            model=existing.model,
            prompt_version=existing.prompt_version,
            schema_version=existing.schema_version,
            output_id=existing.id,
            cached=True,
            created_at=existing.created_at,
            report=report,
        )
    
    # Generate new report
    prompt = build_deep_insights_prompt(insights_payload)
    schema = DeepInsightsCoachReport.model_json_schema()
    
    try:
        report_json = client.create_structured_response(
            DEEP_INSIGHTS_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="DeepInsightsCoachReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    
    report = DeepInsightsCoachReport.model_validate(report_json)
    
    if existing:
        existing.model = client.model
        existing.prompt_version = DEEP_INSIGHTS_PROMPT_VERSION
        existing.schema_version = DEEP_INSIGHTS_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="deep_insights",
            scope_id=player.id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=DEEP_INSIGHTS_PROMPT_VERSION,
            schema_version=DEEP_INSIGHTS_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)
    
    db.commit()
    db.refresh(output)
    
    return DeepInsightsCoachResponse(
        status="ok",
        scope_type=output.scope_type,
        scope_id=output.scope_id,
        analysis_version=insights_payload.analysis_version,
        model=output.model,
        prompt_version=output.prompt_version,
        schema_version=output.schema_version,
        output_id=output.id,
        cached=False,
        created_at=output.created_at,
        report=report,
    )


@router.get("/deep-insights/openings", response_model=OpeningInsightsCoachResponse)
def get_opening_insights(
    username: str = Query(..., min_length=1),
    game_limit: int = Query(default=DEFAULT_DEEP_INSIGHTS_GAMES, ge=1, le=MAX_DEEP_INSIGHTS_GAMES),
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> OpeningInsightsCoachResponse:
    """Get cached opening insights report."""
    try:
        player = get_player(db, username)
        payload = build_deep_insights(db, username, game_limit=game_limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    if payload.games_analyzed == 0:
        raise HTTPException(status_code=404, detail="No analyzed games found.")
    
    input_hash = build_input_hash(
        "opening_insights",
        convert_to_dict(payload),
        client.model,
        prompt_version=OPENING_INSIGHTS_PROMPT_VERSION,
        schema_version=OPENING_INSIGHTS_SCHEMA_VERSION,
    )
    
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "opening_insights",
                models.LlmOutput.scope_id == player.id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    
    if not existing:
        raise HTTPException(status_code=404, detail="Opening insights report not found. Use POST to generate.")
    
    report = OpeningInsightsCoachReport.model_validate(existing.output_json)
    return OpeningInsightsCoachResponse(
        status="ok",
        scope_type=existing.scope_type,
        scope_id=existing.scope_id,
        analysis_version=payload.analysis_version,
        model=existing.model,
        prompt_version=existing.prompt_version,
        schema_version=existing.schema_version,
        output_id=existing.id,
        cached=True,
        created_at=existing.created_at,
        report=report,
    )


@router.post("/deep-insights/openings", response_model=OpeningInsightsCoachResponse)
def generate_opening_insights(
    payload: OpeningInsightsRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> OpeningInsightsCoachResponse:
    """Generate opening-specific coaching insights."""
    try:
        player = get_player(db, payload.username)
        insights_payload = build_deep_insights(db, payload.username, game_limit=payload.game_limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    if insights_payload.games_analyzed == 0:
        raise HTTPException(status_code=400, detail="No analyzed games found.")
    
    input_hash = build_input_hash(
        "opening_insights",
        convert_to_dict(insights_payload),
        client.model,
        prompt_version=OPENING_INSIGHTS_PROMPT_VERSION,
        schema_version=OPENING_INSIGHTS_SCHEMA_VERSION,
    )
    
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "opening_insights",
                models.LlmOutput.scope_id == player.id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    
    if existing and not payload.force:
        report = OpeningInsightsCoachReport.model_validate(existing.output_json)
        return OpeningInsightsCoachResponse(
            status="ok",
            scope_type=existing.scope_type,
            scope_id=existing.scope_id,
            analysis_version=insights_payload.analysis_version,
            model=existing.model,
            prompt_version=existing.prompt_version,
            schema_version=existing.schema_version,
            output_id=existing.id,
            cached=True,
            created_at=existing.created_at,
            report=report,
        )
    
    prompt = build_opening_insights_prompt(insights_payload)
    schema = OpeningInsightsCoachReport.model_json_schema()
    
    try:
        report_json = client.create_structured_response(
            OPENING_INSIGHTS_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="OpeningInsightsCoachReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    
    report = OpeningInsightsCoachReport.model_validate(report_json)
    
    if existing:
        existing.model = client.model
        existing.prompt_version = OPENING_INSIGHTS_PROMPT_VERSION
        existing.schema_version = OPENING_INSIGHTS_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="opening_insights",
            scope_id=player.id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=OPENING_INSIGHTS_PROMPT_VERSION,
            schema_version=OPENING_INSIGHTS_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)
    
    db.commit()
    db.refresh(output)
    
    return OpeningInsightsCoachResponse(
        status="ok",
        scope_type=output.scope_type,
        scope_id=output.scope_id,
        analysis_version=insights_payload.analysis_version,
        model=output.model,
        prompt_version=output.prompt_version,
        schema_version=output.schema_version,
        output_id=output.id,
        cached=False,
        created_at=output.created_at,
        report=report,
    )


@router.get("/deep-insights/time", response_model=TimeInsightsCoachResponse)
def get_time_insights(
    username: str = Query(..., min_length=1),
    game_limit: int = Query(default=DEFAULT_DEEP_INSIGHTS_GAMES, ge=1, le=MAX_DEEP_INSIGHTS_GAMES),
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> TimeInsightsCoachResponse:
    """Get cached time management insights report."""
    try:
        player = get_player(db, username)
        payload = build_deep_insights(db, username, game_limit=game_limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    if payload.games_analyzed == 0:
        raise HTTPException(status_code=404, detail="No analyzed games found.")
    
    input_hash = build_input_hash(
        "time_insights",
        convert_to_dict(payload),
        client.model,
        prompt_version=TIME_INSIGHTS_PROMPT_VERSION,
        schema_version=TIME_INSIGHTS_SCHEMA_VERSION,
    )
    
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "time_insights",
                models.LlmOutput.scope_id == player.id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    
    if not existing:
        raise HTTPException(status_code=404, detail="Time insights report not found. Use POST to generate.")
    
    report = TimeInsightsCoachReport.model_validate(existing.output_json)
    return TimeInsightsCoachResponse(
        status="ok",
        scope_type=existing.scope_type,
        scope_id=existing.scope_id,
        analysis_version=payload.analysis_version,
        model=existing.model,
        prompt_version=existing.prompt_version,
        schema_version=existing.schema_version,
        output_id=existing.id,
        cached=True,
        created_at=existing.created_at,
        report=report,
    )


@router.post("/deep-insights/time", response_model=TimeInsightsCoachResponse)
def generate_time_insights(
    payload: TimeInsightsRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> TimeInsightsCoachResponse:
    """Generate time management coaching insights."""
    try:
        player = get_player(db, payload.username)
        insights_payload = build_deep_insights(db, payload.username, game_limit=payload.game_limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    if insights_payload.games_analyzed == 0:
        raise HTTPException(status_code=400, detail="No analyzed games found.")
    
    input_hash = build_input_hash(
        "time_insights",
        convert_to_dict(insights_payload),
        client.model,
        prompt_version=TIME_INSIGHTS_PROMPT_VERSION,
        schema_version=TIME_INSIGHTS_SCHEMA_VERSION,
    )
    
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "time_insights",
                models.LlmOutput.scope_id == player.id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    
    if existing and not payload.force:
        report = TimeInsightsCoachReport.model_validate(existing.output_json)
        return TimeInsightsCoachResponse(
            status="ok",
            scope_type=existing.scope_type,
            scope_id=existing.scope_id,
            analysis_version=insights_payload.analysis_version,
            model=existing.model,
            prompt_version=existing.prompt_version,
            schema_version=existing.schema_version,
            output_id=existing.id,
            cached=True,
            created_at=existing.created_at,
            report=report,
        )
    
    prompt = build_time_insights_prompt(insights_payload)
    schema = TimeInsightsCoachReport.model_json_schema()
    
    try:
        report_json = client.create_structured_response(
            TIME_INSIGHTS_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="TimeInsightsCoachReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    
    report = TimeInsightsCoachReport.model_validate(report_json)
    
    if existing:
        existing.model = client.model
        existing.prompt_version = TIME_INSIGHTS_PROMPT_VERSION
        existing.schema_version = TIME_INSIGHTS_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="time_insights",
            scope_id=player.id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=TIME_INSIGHTS_PROMPT_VERSION,
            schema_version=TIME_INSIGHTS_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)
    
    db.commit()
    db.refresh(output)
    
    return TimeInsightsCoachResponse(
        status="ok",
        scope_type=output.scope_type,
        scope_id=output.scope_id,
        analysis_version=insights_payload.analysis_version,
        model=output.model,
        prompt_version=output.prompt_version,
        schema_version=output.schema_version,
        output_id=output.id,
        cached=False,
        created_at=output.created_at,
        report=report,
    )

