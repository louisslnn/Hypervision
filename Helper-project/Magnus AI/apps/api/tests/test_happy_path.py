import os

from app.core.config import get_settings
from app.core.constants import COACH_PROMPT_VERSION, COACH_SCHEMA_VERSION
from app.db import models
from app.db.session import engine
from app.main import app
from app.schemas.coach import CoachReport
from app.services.coach import build_game_review_payload, build_input_hash
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

client = TestClient(app)


def test_happy_path_sync_parse_analyze_and_report():
    username = os.getenv("CHESSCOM_USERNAME", "infinitely_0")
    sync_response = client.post("/api/sync", json={"username": username})
    assert sync_response.status_code == 200

    games_response = client.get("/api/games", params={"username": username, "limit": 1})
    assert games_response.status_code == 200
    games = games_response.json()
    assert games
    game_id = games[0]["id"]

    parse_response = client.post(f"/api/games/{game_id}/parse")
    assert parse_response.status_code == 200

    analyze_response = client.post(f"/api/games/{game_id}/analyze", json={"max_plies": 4})
    assert analyze_response.status_code == 200
    analysis_version = analyze_response.json()["analysis_version"]

    settings = get_settings()
    question = "Summarize the game."
    with Session(engine) as session:
        payload, resolved_version = build_game_review_payload(
            session, game_id, analysis_version, max_moments=4
        )
        input_hash = build_input_hash(
            question,
            payload,
            model=settings.openai_model,
            prompt_version=COACH_PROMPT_VERSION,
            schema_version=COACH_SCHEMA_VERSION,
        )
        report = CoachReport(
            summary=["Keep an eye on tactical shots."],
            phase_advice={
                "opening": ["Develop quickly."],
                "middlegame": ["Avoid loose pieces."],
                "endgame": ["Activate the king."],
            },
            critical_moments=[],
            themes=["tactics"],
            training_plan=[],
            limitations=[],
        )
        output = models.LlmOutput(
            scope_type="game",
            scope_id=game_id,
            input_hash=input_hash,
            model=settings.openai_model,
            prompt_version=COACH_PROMPT_VERSION,
            schema_version=COACH_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        session.add(output)
        session.commit()
        assert resolved_version == analysis_version

    coach_response = client.post(
        "/api/coach/query",
        json={"question": question, "game_id": game_id},
    )
    assert coach_response.status_code == 200
    payload = coach_response.json()
    assert payload["report"]["summary"]

    with Session(engine) as session:
        stored = (
            session.execute(select(models.LlmOutput).where(models.LlmOutput.scope_id == game_id))
            .scalars()
            .first()
        )
        assert stored is not None
