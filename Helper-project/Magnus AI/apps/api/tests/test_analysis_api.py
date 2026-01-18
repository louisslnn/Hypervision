import os

from app.db import models
from app.db.session import engine
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

client = TestClient(app)

SAMPLE_MOVES = (
    "1. e4 {[%clk 0:05:00]} 1... e5 {[%clk 0:05:00]} "
    "2. Nf3 {[%clk 0:04:59]} 2... Nc6 {[%clk 0:04:59]} 1/2-1/2"
)
SAMPLE_PGN = "\n".join(['[Event "Test"]', '[TimeControl "300+2"]', SAMPLE_MOVES, ""])


def create_game() -> int:
    with Session(engine) as session:
        player = models.Player(username="analysis-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="analysis-game-1",
            chesscom_url="https://www.chess.com/game/live/4242",
            ingest_version="v0.1",
            time_control="300+2",
            time_class="blitz",
            pgn_raw=SAMPLE_PGN,
        )
        session.add(game)
        session.commit()
        session.refresh(game)
    return game.id


def test_analysis_endpoints_roundtrip():
    os.environ.setdefault("ENGINE_DEPTH", "4")
    os.environ.setdefault("ENGINE_TIME_MS", "50")
    game_id = create_game()

    response = client.post(f"/api/games/{game_id}/analyze", json={})
    assert response.status_code == 200
    payload = response.json()
    assert payload["moves_analyzed"] > 0
    analysis_version = payload["analysis_version"]

    summary_response = client.get(f"/api/games/{game_id}/analysis")
    assert summary_response.status_code == 200
    summary = summary_response.json()
    assert summary["analysis_version"] == analysis_version
    assert summary["move_count"] == payload["moves_analyzed"]
    assert len(summary["critical_moments"]) > 0

    series_response = client.get(f"/api/games/{game_id}/analysis/series")
    assert series_response.status_code == 200
    series_payload = series_response.json()
    assert series_payload["analysis_version"] == analysis_version
    assert len(series_payload["series"]) == payload["moves_analyzed"]

    moves_response = client.get(f"/api/games/{game_id}/moves")
    assert moves_response.status_code == 200
    move_id = moves_response.json()[0]["id"]
    move_analysis_response = client.get(f"/api/moves/{move_id}/analysis")
    assert move_analysis_response.status_code == 200
    move_analysis = move_analysis_response.json()
    assert move_analysis["analysis_version"] == analysis_version

    second_response = client.post(f"/api/games/{game_id}/analyze", json={})
    assert second_response.status_code == 200
    second_payload = second_response.json()
    assert second_payload["moves_analyzed"] == 0
    assert second_payload["moves_skipped"] >= payload["moves_analyzed"]


def test_analyze_all_endpoint():
    os.environ.setdefault("ENGINE_DEPTH", "4")
    os.environ.setdefault("ENGINE_TIME_MS", "50")

    with Session(engine) as session:
        player = models.Player(username="bulk-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game_one = models.Game(
            player_id=player.id,
            uuid="bulk-game-1",
            chesscom_url="https://www.chess.com/game/live/888",
            ingest_version="v0.1",
            time_control="300+2",
            time_class="blitz",
            pgn_raw=SAMPLE_PGN,
        )
        game_two = models.Game(
            player_id=player.id,
            uuid="bulk-game-2",
            chesscom_url="https://www.chess.com/game/live/889",
            ingest_version="v0.1",
            time_control="300+2",
            time_class="blitz",
            pgn_raw=SAMPLE_PGN,
        )
        session.add_all([game_one, game_two])
        session.commit()

    response = client.post(
        "/api/games/analyze-all",
        json={"username": "bulk-user", "max_plies": 4},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["games_total"] == 2
    assert payload["moves_analyzed"] > 0
