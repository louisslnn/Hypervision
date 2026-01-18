from app.core.config import get_settings
from app.core.constants import COACH_PROMPT_VERSION, COACH_SCHEMA_VERSION
from app.db import models
from app.db.session import engine
from app.main import app
from app.schemas.coach import CoachReport
from app.services.coach import build_game_review_payload, build_input_hash
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
        player = models.Player(username="coach-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="coach-game-1",
            chesscom_url="https://www.chess.com/game/live/999",
            ingest_version="v0.1",
            time_control="300+2",
            time_class="blitz",
            pgn_raw=SAMPLE_PGN,
            white_username="coach-user",
            black_username="opponent",
            result_white="win",
            result_black="checkmated",
        )
        session.add(game)
        session.commit()
        session.refresh(game)
        return game.id


def test_coach_query_generates_and_caches():
    game_id = create_game()
    settings = get_settings()
    analysis_version = "Stockfish@local|depth=1|time_ms=10|multipv=1"

    with Session(engine) as session:
        move = models.Move(
            game_id=game_id,
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

        analysis = models.MoveAnalysis(
            move_id=move.id,
            analysis_version=analysis_version,
            eval_before_cp=0,
            eval_before_mate=None,
            eval_after_cp=-20,
            eval_after_mate=None,
            cpl=20,
            best_move_uci="e2e4",
            best_eval_cp=0,
            best_eval_mate=None,
            classification="best",
            tags_json=[],
        )
        session.add(analysis)

        position = models.EnginePosition(
            fen_hash="a" * 64,
            fen=move.fen_before,
            side_to_move="w",
            engine_name="Stockfish",
            engine_version="local",
            analysis_depth=1,
            analysis_time_ms=10,
            analysis_multipv=1,
            analysis_version=analysis_version,
            eval_cp=0,
            eval_mate=None,
            pv_uci="e2e4",
            multipv_json=[],
        )
        session.add(position)
        session.commit()

        payload, resolved_version = build_game_review_payload(
            session, game_id, analysis_version, max_moments=4
        )
        input_hash = build_input_hash(
            "Review the game.",
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

    response = client.post(
        "/api/coach/query",
        json={"question": "Review the game.", "game_id": game_id},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["cached"] is True
    assert payload["prompt_version"] == COACH_PROMPT_VERSION
    assert payload["schema_version"] == COACH_SCHEMA_VERSION
    assert payload["report"]["summary"]

    second = client.post(
        "/api/coach/query",
        json={"question": "Review the game.", "game_id": game_id},
    )
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["cached"] is True
