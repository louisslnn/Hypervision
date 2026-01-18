from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import and_, case, or_, select
from sqlalchemy.orm import Session

from app.core.constants import (
    COMMENTARY_WIZARD_PROMPT_VERSION,
    COMMENTARY_WIZARD_SCHEMA_VERSION,
    GAME_RECAP_PROMPT_VERSION,
    GAME_RECAP_SCHEMA_VERSION,
    MOVE_COACH_PROMPT_VERSION,
    MOVE_COACH_SCHEMA_VERSION,
)
from app.db import models
from app.db.session import get_session
from app.schemas.analysis import (
    AnalysisSeriesPoint,
    AnalyzeAllRequest,
    AnalyzeAllResponse,
    AnalyzeGameRequest,
    AnalyzeGameResponse,
    CriticalMomentOut,
    EvaluationOut,
    GameAnalysisResponse,
    GameAnalysisSeriesResponse,
    MoveAnalysisOut,
)
from app.schemas.coach import (
    CommentaryWizardReport,
    CommentaryWizardRequest,
    CommentaryWizardResponse,
    GameRecapReport,
    GameRecapRequest,
    GameRecapResponse,
    MoveCommentaryReport,
    MoveCommentaryRequest,
    MoveCommentaryResponse,
)
from app.schemas.games import GameOut, GameParseResponse, GamePgnResponse, MoveOut
from app.services.anonymize import anonymize_game
from app.services.bulk_analysis import analyze_all_games
from app.services.engine import StockfishEngineEvaluator, get_engine_config, get_engine_evaluator
from app.services.engine_analysis import (
    analyze_game,
    get_engine_metadata,
    get_game_analysis_rows,
    get_move_analysis,
)
from app.services.game_parser import get_game_by_id, parse_game_moves
from app.services.move_coach import (
    COMMENTARY_WIZARD_SYSTEM_PROMPT,
    GAME_RECAP_SYSTEM_PROMPT,
    MOVE_COACH_SYSTEM_PROMPT,
    build_commentary_wizard_payload,
    build_game_recap_payload,
    build_input_hash,
    build_move_commentary_payload,
    build_prompt,
)
from app.services.openai_client import OpenAIClient, OpenAIResponseError, get_openai_client

router = APIRouter(tags=["games"])

AUTO_ANALYZE_ERRORS = {
    "Moves are not parsed for game.",
    "Engine analysis not found for game.",
    "Engine analysis is incomplete for this game.",
}


def _run_full_engine_analysis(db: Session, game_id: int) -> None:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    config = get_engine_config()
    try:
        with StockfishEngineEvaluator(config) as evaluator:
            analyze_game(db, game, evaluator, force=False, max_plies=None)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/games", response_model=list[GameOut])
def list_games(
    username: Optional[str] = None,
    time_class: Optional[str] = None,
    result: Optional[str] = None,
    color: Optional[str] = None,
    opening: Optional[str] = None,
    opponent_rating_min: Optional[int] = Query(default=None, ge=0),
    opponent_rating_max: Optional[int] = Query(default=None, ge=0),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(default=100, ge=1, le=500),
    anonymize: bool = False,
    db: Session = Depends(get_session),
) -> list[GameOut]:
    normalized_color = color.lower().strip() if color else None
    if normalized_color and normalized_color not in {"white", "black"}:
        raise HTTPException(status_code=400, detail="color must be white or black.")
    if (
        result
        or normalized_color
        or opponent_rating_min is not None
        or opponent_rating_max is not None
    ) and not username:
        raise HTTPException(
            status_code=400,
            detail="username is required for result, color, or opponent rating filters.",
        )

    stmt = select(models.Game)
    if username:
        stmt = stmt.join(models.Player, models.Game.player_id == models.Player.id).where(
            models.Player.username == username
        )
    if time_class:
        stmt = stmt.where(models.Game.time_class == time_class)
    if opening:
        stmt = stmt.where(models.Game.eco_url.contains(opening))
    if date_from:
        stmt = stmt.where(models.Game.end_time >= date_from)
    if date_to:
        stmt = stmt.where(models.Game.end_time <= date_to)
    if normalized_color == "white":
        stmt = stmt.where(models.Game.white_username == username)
    elif normalized_color == "black":
        stmt = stmt.where(models.Game.black_username == username)
    if result:
        result_key = result.strip().lower()
        result_groups = {
            "win": {"win"},
            "draw": {
                "draw",
                "stalemate",
                "repetition",
                "agreed",
                "insufficient",
                "50move",
                "timevsinsufficient",
            },
            "loss": {"checkmated", "resigned", "timeout", "abandoned", "lose", "time"},
        }
        outcome_set = result_groups.get(result_key)
        if outcome_set:
            if normalized_color == "white":
                stmt = stmt.where(models.Game.result_white.in_(outcome_set))
            elif normalized_color == "black":
                stmt = stmt.where(models.Game.result_black.in_(outcome_set))
            else:
                stmt = stmt.where(
                    or_(
                        and_(
                            models.Game.white_username == username,
                            models.Game.result_white.in_(outcome_set),
                        ),
                        and_(
                            models.Game.black_username == username,
                            models.Game.result_black.in_(outcome_set),
                        ),
                    )
                )
        else:
            stmt = stmt.where(
                or_(
                    models.Game.result_white == result,
                    models.Game.result_black == result,
                )
            )
    if opponent_rating_min is not None or opponent_rating_max is not None:
        opponent_rating = case(
            (models.Game.white_username == username, models.Game.black_rating_post),
            else_=models.Game.white_rating_post,
        )
        if opponent_rating_min is not None:
            stmt = stmt.where(opponent_rating >= opponent_rating_min)
        if opponent_rating_max is not None:
            stmt = stmt.where(opponent_rating <= opponent_rating_max)
    stmt = stmt.order_by(models.Game.end_time.desc().nulls_last(), models.Game.id.desc())
    stmt = stmt.limit(limit)
    games = db.execute(stmt).scalars().all()
    game_out = [GameOut.model_validate(game) for game in games]
    if not anonymize:
        return game_out

    player_lookup: dict[int, str] = {}
    if not username and games:
        player_ids = {game.player_id for game in games}
        if player_ids:
            rows = db.execute(
                select(models.Player.id, models.Player.username).where(
                    models.Player.id.in_(player_ids)
                )
            ).all()
            player_lookup = {row[0]: row[1] for row in rows}

    anonymized = []
    for game, game_item in zip(games, game_out):
        player_username = username or player_lookup.get(game.player_id)
        anonymized.append(anonymize_game(game_item, player_username))
    return anonymized


@router.get("/games/{game_id}", response_model=GameOut)
def get_game(
    game_id: int,
    anonymize: bool = False,
    db: Session = Depends(get_session),
) -> GameOut:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    game_out = GameOut.model_validate(game)
    if not anonymize:
        return game_out
    player_username = (
        db.execute(select(models.Player.username).where(models.Player.id == game.player_id))
        .scalars()
        .first()
    )
    return anonymize_game(game_out, player_username)


@router.get("/games/{game_id}/pgn", response_model=GamePgnResponse)
def get_game_pgn(game_id: int, db: Session = Depends(get_session)) -> GamePgnResponse:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if not game.pgn_raw:
        raise HTTPException(status_code=404, detail="PGN not found.")
    return GamePgnResponse(game_id=game.id, pgn=game.pgn_raw)


@router.get("/games/{game_id}/moves", response_model=list[MoveOut])
def get_game_moves(game_id: int, db: Session = Depends(get_session)) -> list[MoveOut]:
    stmt = select(models.Move).where(models.Move.game_id == game_id).order_by(models.Move.ply)
    moves = db.execute(stmt).scalars().all()
    if not moves:
        game = get_game_by_id(db, game_id)
        if not game:
            raise HTTPException(status_code=404, detail="Game not found.")
        if game.pgn_raw:
            try:
                parse_game_moves(db, game, force=False)
                db.commit()
            except ValueError:
                db.rollback()
            moves = db.execute(stmt).scalars().all()
    return [MoveOut.model_validate(move) for move in moves]


@router.post("/games/{game_id}/parse", response_model=GameParseResponse)
def parse_game(
    game_id: int,
    force: bool = False,
    db: Session = Depends(get_session),
) -> GameParseResponse:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    try:
        moves_created, moves_existing = parse_game_moves(db, game, force=force)
        db.commit()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GameParseResponse(
        status="ok",
        moves_created=moves_created,
        moves_existing=moves_existing,
    )


@router.post("/games/{game_id}/analyze", response_model=AnalyzeGameResponse)
def analyze_game_endpoint(
    game_id: int,
    payload: AnalyzeGameRequest = Body(default_factory=AnalyzeGameRequest),
    db: Session = Depends(get_session),
    evaluator: StockfishEngineEvaluator = Depends(get_engine_evaluator),
) -> AnalyzeGameResponse:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    try:
        result = analyze_game(
            db,
            game,
            evaluator,
            force=payload.force,
            max_plies=payload.max_plies,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AnalyzeGameResponse(
        status="ok",
        analysis_version=result.analysis_version,
        engine_name=result.engine_name,
        engine_version=result.engine_version,
        analysis_depth=result.analysis_depth,
        analysis_time_ms=result.analysis_time_ms,
        analysis_multipv=result.analysis_multipv,
        moves_analyzed=result.moves_analyzed,
        moves_skipped=result.moves_skipped,
    )


@router.post("/games/analyze-all", response_model=AnalyzeAllResponse)
def analyze_all_games_endpoint(
    payload: AnalyzeAllRequest,
    db: Session = Depends(get_session),
) -> AnalyzeAllResponse:
    try:
        result = analyze_all_games(
            db,
            username=payload.username,
            force=payload.force,
            max_plies=payload.max_plies,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AnalyzeAllResponse(
        status="ok",
        player_username=payload.username.strip(),
        analysis_version=result.analysis_version,
        engine_name=result.engine_name,
        engine_version=result.engine_version,
        analysis_depth=result.analysis_depth,
        analysis_time_ms=result.analysis_time_ms,
        analysis_multipv=result.analysis_multipv,
        games_total=result.games_total,
        games_analyzed=result.games_analyzed,
        games_skipped=result.games_skipped,
        games_failed=result.games_failed,
        moves_analyzed=result.moves_analyzed,
        moves_skipped=result.moves_skipped,
    )


@router.get("/games/{game_id}/commentary", response_model=MoveCommentaryResponse)
def get_move_commentary(
    game_id: int,
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> MoveCommentaryResponse:
    try:
        review_payload, resolved_version = build_move_commentary_payload(
            db, game_id, analysis_version
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_hash = build_input_hash(
        "move_commentary",
        review_payload,
        client.model,
        prompt_version=MOVE_COACH_PROMPT_VERSION,
        schema_version=MOVE_COACH_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "move_commentary",
                models.LlmOutput.scope_id == game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Move commentary not found.")

    report = MoveCommentaryReport.model_validate(existing.output_json)
    return MoveCommentaryResponse(
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


@router.post("/games/{game_id}/commentary", response_model=MoveCommentaryResponse)
def generate_move_commentary(
    game_id: int,
    payload: MoveCommentaryRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> MoveCommentaryResponse:
    try:
        review_payload, resolved_version = build_move_commentary_payload(
            db, game_id, payload.analysis_version
        )
    except ValueError as exc:
        message = str(exc)
        if message in AUTO_ANALYZE_ERRORS:
            _run_full_engine_analysis(db, game_id)
            try:
                review_payload, resolved_version = build_move_commentary_payload(
                    db, game_id, None
                )
            except ValueError as retry_exc:
                raise HTTPException(status_code=400, detail=str(retry_exc)) from retry_exc
        else:
            raise HTTPException(status_code=400, detail=message) from exc

    input_hash = build_input_hash(
        "move_commentary",
        review_payload,
        client.model,
        prompt_version=MOVE_COACH_PROMPT_VERSION,
        schema_version=MOVE_COACH_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "move_commentary",
                models.LlmOutput.scope_id == game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing and not payload.force:
        report = MoveCommentaryReport.model_validate(existing.output_json)
        return MoveCommentaryResponse(
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

    prompt = build_prompt(review_payload)
    schema = MoveCommentaryReport.model_json_schema()
    try:
        report_json = client.create_structured_response(
            MOVE_COACH_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="MoveCommentaryReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    report = MoveCommentaryReport.model_validate(report_json)
    if existing:
        existing.model = client.model
        existing.prompt_version = MOVE_COACH_PROMPT_VERSION
        existing.schema_version = MOVE_COACH_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="move_commentary",
            scope_id=game_id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=MOVE_COACH_PROMPT_VERSION,
            schema_version=MOVE_COACH_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)

    db.commit()
    db.refresh(output)

    return MoveCommentaryResponse(
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


@router.post("/games/{game_id}/commentary/wizard", response_model=CommentaryWizardResponse)
def generate_commentary_wizard(
    game_id: int,
    payload: CommentaryWizardRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> CommentaryWizardResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required.")

    commentary_outputs = (
        db.execute(
            select(models.LlmOutput)
            .where(
                models.LlmOutput.scope_type == "move_commentary",
                models.LlmOutput.scope_id == game_id,
            )
            .order_by(models.LlmOutput.created_at.desc())
        )
        .scalars()
        .all()
    )
    selected_output: models.LlmOutput | None = None
    selected_report: MoveCommentaryReport | None = None
    for output in commentary_outputs:
        report = MoveCommentaryReport.model_validate(output.output_json)
        if payload.analysis_version and report.analysis_version != payload.analysis_version:
            continue
        selected_output = output
        selected_report = report
        break

    if not selected_output or not selected_report:
        raise HTTPException(status_code=404, detail="Move commentary not found.")

    resolved_version = selected_report.analysis_version
    if payload.analysis_version and payload.analysis_version != resolved_version:
        raise HTTPException(status_code=400, detail="analysis_version does not match commentary.")

    try:
        wizard_payload, resolved_version = build_commentary_wizard_payload(
            db,
            game_id,
            payload.move_id,
            resolved_version,
            question,
            selected_report,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_hash = build_input_hash(
        "commentary_wizard",
        wizard_payload,
        client.model,
        prompt_version=COMMENTARY_WIZARD_PROMPT_VERSION,
        schema_version=COMMENTARY_WIZARD_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "commentary_wizard",
                models.LlmOutput.scope_id == game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing and not payload.force:
        report = CommentaryWizardReport.model_validate(existing.output_json)
        return CommentaryWizardResponse(
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

    prompt = build_prompt(wizard_payload)
    schema = CommentaryWizardReport.model_json_schema()
    try:
        report_json = client.create_structured_response(
            COMMENTARY_WIZARD_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="CommentaryWizardReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    report = CommentaryWizardReport.model_validate(report_json).model_copy(
        update={
            "game_id": game_id,
            "move_id": payload.move_id,
            "analysis_version": resolved_version,
            "question": question,
        }
    )

    if existing:
        existing.model = client.model
        existing.prompt_version = COMMENTARY_WIZARD_PROMPT_VERSION
        existing.schema_version = COMMENTARY_WIZARD_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="commentary_wizard",
            scope_id=game_id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=COMMENTARY_WIZARD_PROMPT_VERSION,
            schema_version=COMMENTARY_WIZARD_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)

    db.commit()
    db.refresh(output)

    return CommentaryWizardResponse(
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


@router.get("/games/{game_id}/recap", response_model=GameRecapResponse)
def get_game_recap(
    game_id: int,
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> GameRecapResponse:
    try:
        review_payload, resolved_version = build_game_recap_payload(db, game_id, analysis_version)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_hash = build_input_hash(
        "game_recap",
        review_payload,
        client.model,
        prompt_version=GAME_RECAP_PROMPT_VERSION,
        schema_version=GAME_RECAP_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "game_recap",
                models.LlmOutput.scope_id == game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Game recap not found.")

    report = GameRecapReport.model_validate(existing.output_json)
    return GameRecapResponse(
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


@router.post("/games/{game_id}/recap", response_model=GameRecapResponse)
def generate_game_recap(
    game_id: int,
    payload: GameRecapRequest,
    db: Session = Depends(get_session),
    client: OpenAIClient = Depends(get_openai_client),
) -> GameRecapResponse:
    try:
        review_payload, resolved_version = build_game_recap_payload(
            db, game_id, payload.analysis_version
        )
    except ValueError as exc:
        message = str(exc)
        if message in AUTO_ANALYZE_ERRORS:
            _run_full_engine_analysis(db, game_id)
            try:
                review_payload, resolved_version = build_game_recap_payload(db, game_id, None)
            except ValueError as retry_exc:
                raise HTTPException(status_code=400, detail=str(retry_exc)) from retry_exc
        else:
            raise HTTPException(status_code=400, detail=message) from exc

    input_hash = build_input_hash(
        "game_recap",
        review_payload,
        client.model,
        prompt_version=GAME_RECAP_PROMPT_VERSION,
        schema_version=GAME_RECAP_SCHEMA_VERSION,
    )
    existing = (
        db.execute(
            select(models.LlmOutput).where(
                models.LlmOutput.scope_type == "game_recap",
                models.LlmOutput.scope_id == game_id,
                models.LlmOutput.input_hash == input_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing and not payload.force:
        report = GameRecapReport.model_validate(existing.output_json)
        return GameRecapResponse(
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

    prompt = build_prompt(review_payload)
    schema = GameRecapReport.model_json_schema()
    try:
        report_json = client.create_structured_response(
            GAME_RECAP_SYSTEM_PROMPT,
            prompt,
            schema,
            schema_name="GameRecapReport",
        )
    except OpenAIResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    report = GameRecapReport.model_validate(report_json)
    if existing:
        existing.model = client.model
        existing.prompt_version = GAME_RECAP_PROMPT_VERSION
        existing.schema_version = GAME_RECAP_SCHEMA_VERSION
        existing.output_json = report.model_dump()
        output = existing
    else:
        output = models.LlmOutput(
            scope_type="game_recap",
            scope_id=game_id,
            input_hash=input_hash,
            model=client.model,
            prompt_version=GAME_RECAP_PROMPT_VERSION,
            schema_version=GAME_RECAP_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        db.add(output)

    db.commit()
    db.refresh(output)

    return GameRecapResponse(
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


@router.get("/games/{game_id}/analysis", response_model=GameAnalysisResponse)
def get_game_analysis(
    game_id: int,
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
) -> GameAnalysisResponse:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")

    resolved_version, rows = get_game_analysis_rows(db, game_id, analysis_version)
    if not resolved_version:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    metadata = get_engine_metadata(db, resolved_version)
    engine_name = metadata.name if metadata else "unknown"
    engine_version = metadata.version if metadata else "unknown"
    analysis_depth = metadata.depth if metadata else 0
    analysis_time_ms = metadata.time_ms if metadata else 0
    analysis_multipv = metadata.multipv if metadata else 1

    critical_rows = [row for row in rows if row[0].cpl is not None]
    critical_rows.sort(key=lambda item: item[0].cpl or 0, reverse=True)
    critical_rows = critical_rows[:5]

    critical_moments = [
        CriticalMomentOut(
            move_id=move.id,
            ply=move.ply,
            move_san=move.move_san,
            fen_before=move.fen_before,
            cpl=analysis.cpl,
            classification=analysis.classification,
            best_move_uci=analysis.best_move_uci,
            eval_before=EvaluationOut(
                eval_cp=analysis.eval_before_cp,
                eval_mate=analysis.eval_before_mate,
            ),
            eval_after=EvaluationOut(
                eval_cp=analysis.eval_after_cp,
                eval_mate=analysis.eval_after_mate,
            ),
        )
        for analysis, move in critical_rows
    ]

    return GameAnalysisResponse(
        status="ok",
        analysis_version=resolved_version,
        engine_name=engine_name,
        engine_version=engine_version,
        analysis_depth=analysis_depth,
        analysis_time_ms=analysis_time_ms,
        analysis_multipv=analysis_multipv,
        move_count=len(rows),
        critical_moments=critical_moments,
    )


@router.get("/games/{game_id}/analysis/series", response_model=GameAnalysisSeriesResponse)
def get_game_analysis_series(
    game_id: int,
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
) -> GameAnalysisSeriesResponse:
    game = get_game_by_id(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")

    resolved_version, rows = get_game_analysis_rows(db, game_id, analysis_version)
    if not resolved_version:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    series = [
        AnalysisSeriesPoint(
            move_id=move.id,
            ply=move.ply,
            move_san=move.move_san,
            move_uci=move.move_uci,
            fen_before=move.fen_before,
            fen_after=move.fen_after,
            eval_before=EvaluationOut(
                eval_cp=analysis.eval_before_cp,
                eval_mate=analysis.eval_before_mate,
            ),
            eval_after=EvaluationOut(
                eval_cp=analysis.eval_after_cp,
                eval_mate=analysis.eval_after_mate,
            ),
            cpl=analysis.cpl,
            classification=analysis.classification,
            best_move_uci=analysis.best_move_uci,
            clock_remaining_ms=move.clock_remaining_ms,
            time_spent_ms=move.time_spent_ms,
        )
        for analysis, move in rows
    ]

    return GameAnalysisSeriesResponse(
        status="ok",
        analysis_version=resolved_version,
        series=series,
    )


@router.get("/moves/{move_id}/analysis", response_model=MoveAnalysisOut)
def get_move_analysis_endpoint(
    move_id: int,
    analysis_version: str | None = None,
    db: Session = Depends(get_session),
) -> MoveAnalysisOut:
    analysis = get_move_analysis(db, move_id, analysis_version)
    if not analysis:
        raise HTTPException(status_code=404, detail="Move analysis not found.")

    return MoveAnalysisOut(
        id=analysis.id,
        move_id=analysis.move_id,
        analysis_version=analysis.analysis_version,
        eval_before=EvaluationOut(
            eval_cp=analysis.eval_before_cp,
            eval_mate=analysis.eval_before_mate,
        ),
        eval_after=EvaluationOut(
            eval_cp=analysis.eval_after_cp,
            eval_mate=analysis.eval_after_mate,
        ),
        cpl=analysis.cpl,
        best_move_uci=analysis.best_move_uci,
        best_eval=EvaluationOut(
            eval_cp=analysis.best_eval_cp,
            eval_mate=analysis.best_eval_mate,
        ),
        classification=analysis.classification,
        tags=analysis.tags_json or [],
        created_at=analysis.created_at,
    )
