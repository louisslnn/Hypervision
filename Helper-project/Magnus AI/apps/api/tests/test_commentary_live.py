import os
import shutil
from pathlib import Path

from app.db import models
from app.db.session import engine
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

client = TestClient(app)

PGN_SAMPLE = """[Event "Commentary Live Test"]
[Site "?"]
[Date "2024.01.01"]
[Round "-"]
[White "commentary-live-user"]
[Black "opponent"]
[Result "1-0"]
[TimeControl "60+0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
"""


def assert_stockfish_available() -> None:
    path = os.getenv("STOCKFISH_PATH", "stockfish")
    if Path(path).exists():
        return
    if shutil.which(path):
        return
    raise AssertionError(f"Stockfish not found at {path}.")


def test_generate_move_commentary_live(monkeypatch):
    api_key = os.getenv("OPENAI_API_KEY")
    assert api_key, "OPENAI_API_KEY is required for live commentary test."
    assert_stockfish_available()

    monkeypatch.setenv("ENGINE_DEPTH", "1")
    monkeypatch.setenv("ENGINE_TIME_MS", "20")
    monkeypatch.setenv("ENGINE_MULTIPV", "1")
    monkeypatch.setenv("OPENAI_TIMEOUT", "300")

    with Session(engine) as session:
        player = models.Player(username="commentary-live-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="commentary-live-game-1",
            chesscom_url="https://www.chess.com/game/live/999999",
            ingest_version="v0.1",
            time_control="60+0",
            time_class="blitz",
            rated=True,
            white_username=player.username,
            black_username="opponent",
            result_white="win",
            result_black="resigned",
            pgn_raw=PGN_SAMPLE,
        )
        session.add(game)
        session.commit()
        session.refresh(game)
        game_id = game.id

    response = client.post(f"/api/games/{game_id}/commentary", json={})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["report"]["moves"]
    assert payload["report"]["summary"]
    first_move = payload["report"]["moves"][0]
    assert isinstance(first_move.get("best_move_explanation"), str)
