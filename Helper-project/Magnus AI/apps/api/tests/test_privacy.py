from app.db import models
from app.db.session import engine
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

client = TestClient(app)


def seed_data() -> None:
    with Session(engine) as session:
        player = models.Player(username="purge-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="purge-game",
            chesscom_url="https://www.chess.com/game/live/1234",
            ingest_version="v0.1",
            pgn_raw='[Event "Test"]\n1. e4 e5 1/2-1/2',
            white_username="purge-user",
            black_username="opponent",
        )
        session.add(game)
        session.commit()
        session.refresh(game)

        move = models.Move(
            game_id=game.id,
            ply=1,
            move_san="e4",
            move_uci="e2e4",
            fen_before="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            fen_after="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
            is_check=False,
            is_mate=False,
        )
        session.add(move)
        session.commit()
        session.refresh(move)

        position = models.EnginePosition(
            fen_hash="a" * 64,
            fen=move.fen_before,
            side_to_move="w",
            engine_name="FakeFish",
            engine_version="0.0",
            analysis_depth=1,
            analysis_time_ms=1,
            analysis_multipv=1,
            analysis_version="fake",
            eval_cp=0,
            eval_mate=None,
            pv_uci="e2e4",
            multipv_json=[],
        )
        session.add(position)

        analysis = models.MoveAnalysis(
            move_id=move.id,
            analysis_version="fake",
            eval_before_cp=0,
            eval_before_mate=None,
            eval_after_cp=10,
            eval_after_mate=None,
            cpl=0,
            best_move_uci="e2e4",
            best_eval_cp=0,
            best_eval_mate=None,
            classification="best",
            tags_json=[],
        )
        session.add(analysis)

        pattern = models.Pattern(
            player_id=player.id,
            analysis_version="fake",
            pattern_key="opening_slip",
            title="Opening slips",
            description="Early mistakes.",
            severity_score=0.4,
            occurrences=1,
            average_cpl=50.0,
        )
        session.add(pattern)
        session.commit()
        session.refresh(pattern)

        example = models.PatternExample(
            pattern_id=pattern.id,
            game_id=game.id,
            move_id=move.id,
            fen=move.fen_before,
            notes="Early phase mistake",
        )
        session.add(example)

        output = models.LlmOutput(
            scope_type="game",
            scope_id=game.id,
            input_hash="b" * 64,
            model="fake",
            prompt_version="v0.1",
            schema_version="v0.1",
            output_json={"summary": []},
        )
        session.add(output)

        job = models.Job(
            job_type="engine_analysis",
            status="completed",
            payload_json={"game_id": game.id},
            result_json={"moves_analyzed": 1},
        )
        session.add(job)
        session.commit()


def test_data_purge_clears_tables():
    seed_data()
    response = client.delete("/api/data/purge")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["deleted"]["players"] >= 1

    with Session(engine) as session:
        assert session.execute(select(models.Player)).scalars().first() is None
        assert session.execute(select(models.Game)).scalars().first() is None
        assert session.execute(select(models.Move)).scalars().first() is None
        assert session.execute(select(models.EnginePosition)).scalars().first() is None
        assert session.execute(select(models.MoveAnalysis)).scalars().first() is None
        assert session.execute(select(models.LlmOutput)).scalars().first() is None
        assert session.execute(select(models.Pattern)).scalars().first() is None
        assert session.execute(select(models.PatternExample)).scalars().first() is None
        assert session.execute(select(models.Job)).scalars().first() is None
