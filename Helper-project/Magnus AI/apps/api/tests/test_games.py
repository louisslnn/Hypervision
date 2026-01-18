from datetime import datetime, timezone

from app.db import models
from app.db.session import engine
from app.main import app
from app.services.anonymize import hash_username
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
        player = models.Player(username="parser")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="parse-game-1",
            chesscom_url="https://www.chess.com/game/live/999",
            ingest_version="v0.1",
            time_control="300+2",
            time_class="blitz",
            pgn_raw=SAMPLE_PGN,
        )
        session.add(game)
        session.commit()
        session.refresh(game)
        return game.id


def create_named_game() -> int:
    with Session(engine) as session:
        player = models.Player(username="anon-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="anon-game-1",
            chesscom_url="https://www.chess.com/game/live/333",
            ingest_version="v0.1",
            time_control="300+0",
            time_class="blitz",
            white_username="anon-user",
            black_username="opponent",
            pgn_raw=SAMPLE_PGN,
        )
        session.add(game)
        session.commit()
        session.refresh(game)
        return game.id


def test_parse_endpoint_creates_moves():
    game_id = create_game()

    response = client.post(f"/api/games/{game_id}/parse")
    assert response.status_code == 200
    payload = response.json()
    assert payload["moves_created"] == 4

    moves_response = client.get(f"/api/games/{game_id}/moves")
    assert moves_response.status_code == 200
    moves = moves_response.json()
    assert len(moves) == 4


def test_moves_endpoint_auto_parses():
    game_id = create_game()

    moves_response = client.get(f"/api/games/{game_id}/moves")
    assert moves_response.status_code == 200
    moves = moves_response.json()
    assert len(moves) == 4


def test_games_list_returns_game():
    game_id = create_game()

    response = client.get("/api/games?limit=10")
    assert response.status_code == 200
    payload = response.json()
    assert any(game["id"] == game_id for game in payload)


def test_games_filters_by_color_result_opening_and_rating():
    with Session(engine) as session:
        player = models.Player(username="filter-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game_white = models.Game(
            player_id=player.id,
            uuid="filter-game-1",
            chesscom_url="https://www.chess.com/game/live/111",
            ingest_version="v0.1",
            time_control="300+0",
            time_class="blitz",
            white_username="filter-user",
            black_username="opponent-a",
            white_rating_post=1600,
            black_rating_post=1500,
            result_white="win",
            result_black="checkmated",
            eco_url="https://www.chess.com/openings/Sicilian-Defense-B12",
            end_time=datetime(2024, 1, 10, tzinfo=timezone.utc),
        )
        game_black = models.Game(
            player_id=player.id,
            uuid="filter-game-2",
            chesscom_url="https://www.chess.com/game/live/222",
            ingest_version="v0.1",
            time_control="600+5",
            time_class="rapid",
            white_username="opponent-b",
            black_username="filter-user",
            white_rating_post=1550,
            black_rating_post=1520,
            result_white="win",
            result_black="resigned",
            eco_url="https://www.chess.com/openings/Queens-Gambit",
            end_time=datetime(2024, 2, 5, tzinfo=timezone.utc),
        )
        session.add_all([game_white, game_black])
        session.commit()

    response = client.get(
        "/api/games",
        params={
            "username": "filter-user",
            "color": "white",
            "result": "win",
            "opening": "B12",
            "opponent_rating_min": 1450,
            "opponent_rating_max": 1550,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["uuid"] == "filter-game-1"

    response = client.get(
        "/api/games",
        params={
            "username": "filter-user",
            "date_from": "2024-02-01T00:00:00Z",
            "date_to": "2024-02-28T23:59:59Z",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["uuid"] == "filter-game-2"


def test_games_anonymize_hashes_opponent():
    game_id = create_named_game()
    response = client.get("/api/games", params={"anonymize": "true"})
    assert response.status_code == 200
    payload = response.json()
    target = next(game for game in payload if game["id"] == game_id)
    assert target["white_username"] == "anon-user"
    assert target["black_username"] == hash_username("opponent")

    response = client.get(f"/api/games/{game_id}", params={"anonymize": "true"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["white_username"] == "anon-user"
    assert payload["black_username"] == hash_username("opponent")


def test_game_pgn_endpoint_returns_pgn():
    game_id = create_game()
    response = client.get(f"/api/games/{game_id}/pgn")
    assert response.status_code == 200
    payload = response.json()
    assert payload["game_id"] == game_id
    assert "TimeControl" in payload["pgn"]
