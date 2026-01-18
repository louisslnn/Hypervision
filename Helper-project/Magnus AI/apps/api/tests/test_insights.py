from datetime import datetime, timezone

from app.db import models
from app.db.session import engine
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

client = TestClient(app)


def seed_insights_data() -> None:
    with Session(engine) as session:
        player = models.Player(username="insights-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game_white = models.Game(
            player_id=player.id,
            uuid="insights-game-1",
            chesscom_url="https://www.chess.com/game/live/301",
            ingest_version="v0.1",
            time_control="300+0",
            time_class="blitz",
            white_username="insights-user",
            black_username="opponent-a",
            white_rating_post=1600,
            black_rating_post=1550,
            result_white="win",
            result_black="checkmated",
            eco_url="https://www.chess.com/openings/Sicilian-Defense-B12",
            end_time=datetime(2024, 1, 10, tzinfo=timezone.utc),
        )
        game_black = models.Game(
            player_id=player.id,
            uuid="insights-game-2",
            chesscom_url="https://www.chess.com/game/live/302",
            ingest_version="v0.1",
            time_control="600+5",
            time_class="rapid",
            white_username="opponent-b",
            black_username="insights-user",
            white_rating_post=1700,
            black_rating_post=1650,
            result_white="win",
            result_black="resigned",
            eco_url="https://www.chess.com/openings/French-Defense",
            end_time=datetime(2024, 2, 5, tzinfo=timezone.utc),
        )
        session.add_all([game_white, game_black])
        session.commit()
        session.refresh(game_white)
        session.refresh(game_black)

        move_white_player = models.Move(
            game_id=game_white.id,
            ply=1,
            move_san="e4",
            move_uci="e2e4",
            fen_before="start",
            fen_after="after",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=20000,
            time_spent_ms=500,
            capture_piece="p",
        )
        move_white_opponent = models.Move(
            game_id=game_white.id,
            ply=2,
            move_san="c5",
            move_uci="c7c5",
            fen_before="after",
            fen_after="after2",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=45000,
            time_spent_ms=4000,
        )
        move_black_opponent = models.Move(
            game_id=game_black.id,
            ply=1,
            move_san="d4",
            move_uci="d2d4",
            fen_before="start",
            fen_after="after",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=50000,
            time_spent_ms=3000,
        )
        move_black_player = models.Move(
            game_id=game_black.id,
            ply=2,
            move_san="d5",
            move_uci="d7d5",
            fen_before="after",
            fen_after="after2",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=50000,
            time_spent_ms=4000,
        )
        session.add_all(
            [move_white_player, move_white_opponent, move_black_opponent, move_black_player]
        )
        session.commit()
        session.refresh(move_white_player)
        session.refresh(move_black_player)

        analysis_white = models.MoveAnalysis(
            move_id=move_white_player.id,
            analysis_version="v1",
            eval_before_cp=0,
            eval_before_mate=None,
            eval_after_cp=-300,
            eval_after_mate=None,
            cpl=300,
            best_move_uci="e2e4",
            best_eval_cp=0,
            best_eval_mate=None,
            classification="blunder",
            tags_json=[],
        )
        analysis_black = models.MoveAnalysis(
            move_id=move_black_player.id,
            analysis_version="v1",
            eval_before_cp=0,
            eval_before_mate=None,
            eval_after_cp=-150,
            eval_after_mate=None,
            cpl=150,
            best_move_uci="d7d5",
            best_eval_cp=0,
            best_eval_mate=None,
            classification="mistake",
            tags_json=[],
        )
        session.add_all([analysis_white, analysis_black])

        sync_run = models.SyncRun(
            status="completed",
            player_username="insights-user",
            sync_version="v0.1",
            finished_at=datetime(2024, 3, 1, tzinfo=timezone.utc),
        )
        session.add(sync_run)
        session.commit()


def test_insights_endpoints():
    seed_insights_data()

    overview = client.get("/api/insights/overview", params={"username": "insights-user"})
    assert overview.status_code == 200
    payload = overview.json()
    assert payload["games"] == 2
    assert payload["moves_analyzed"] == 2
    assert payload["blunders"] == 1
    assert payload["mistakes"] == 1

    openings = client.get("/api/insights/openings", params={"username": "insights-user"})
    assert openings.status_code == 200
    openings_payload = openings.json()
    assert len(openings_payload["openings"]) == 2

    time = client.get(
        "/api/insights/time",
        params={"username": "insights-user", "threshold_ms": 30000},
    )
    assert time.status_code == 200
    time_payload = time.json()
    assert time_payload["time_trouble_moves"] == 1
    assert time_payload["time_trouble_blunders"] == 1

    patterns = client.get("/api/insights/patterns", params={"username": "insights-user"})
    assert patterns.status_code == 200
    patterns_payload = patterns.json()
    keys = {pattern["pattern_key"] for pattern in patterns_payload["patterns"]}
    assert "time_trouble_blunder" in keys
    assert "opening_slip" in keys
    assert "greedy_capture" in keys
    assert "impulsive_blunder" in keys
    first = patterns_payload["patterns"][0]
    assert first["description"]
    assert isinstance(first["examples"], list)
