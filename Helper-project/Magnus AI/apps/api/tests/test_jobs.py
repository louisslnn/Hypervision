import os
import shutil

from app.core.constants import COACH_PROMPT_VERSION, COACH_SCHEMA_VERSION
from app.db import models
from app.db.session import SessionLocal
from app.schemas.coach import CoachReport
from app.services.coach import build_game_review_payload, build_input_hash
from app.services.jobs import (
    JOB_STATUS_COMPLETED,
    enqueue_coach_job,
    enqueue_engine_job,
    process_pending_jobs,
)
from sqlalchemy.orm import Session

SAMPLE_MOVES = (
    "1. e4 {[%clk 0:05:00]} 1... e5 {[%clk 0:05:00]} "
    "2. Nf3 {[%clk 0:04:59]} 2... Nc6 {[%clk 0:04:59]} 1/2-1/2"
)
SAMPLE_PGN = "\n".join(['[Event "Test"]', '[TimeControl "300+2"]', SAMPLE_MOVES, ""])


def ensure_stockfish_path() -> None:
    if os.getenv("STOCKFISH_PATH"):
        return
    found = shutil.which("stockfish")
    if found:
        os.environ["STOCKFISH_PATH"] = found
        return
    raise RuntimeError("STOCKFISH_PATH is not set and stockfish not found on PATH.")


def create_game(session: Session) -> int:
    player = models.Player(username="jobs-user")
    session.add(player)
    session.commit()
    session.refresh(player)

    game = models.Game(
        player_id=player.id,
        uuid="jobs-game-1",
        chesscom_url="https://www.chess.com/game/live/404",
        ingest_version="v0.1",
        time_control="300+2",
        time_class="blitz",
        pgn_raw=SAMPLE_PGN,
        white_username="jobs-user",
        black_username="opponent",
    )
    session.add(game)
    session.commit()
    session.refresh(game)
    return game.id


def seed_cached_report(session: Session, game_id: int, question: str) -> None:
    analysis_version = "Stockfish@local|depth=1|time_ms=10|multipv=1"
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
        eval_after_cp=-50,
        eval_after_mate=None,
        cpl=50,
        best_move_uci="e2e4",
        best_eval_cp=0,
        best_eval_mate=None,
        classification="inaccuracy",
        tags_json=[],
    )
    session.add(analysis)

    engine_position = models.EnginePosition(
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
    session.add(engine_position)
    session.commit()

    payload, resolved_version = build_game_review_payload(
        session, game_id, analysis_version, max_moments=4
    )
    input_hash = build_input_hash(
        question,
        payload,
        model="gpt-5-mini",
        prompt_version=COACH_PROMPT_VERSION,
        schema_version=COACH_SCHEMA_VERSION,
    )
    report = CoachReport(
        summary=["Keep development moving."],
        phase_advice={
            "opening": ["Develop quickly."],
            "middlegame": ["Avoid loose pieces."],
            "endgame": ["Activate the king."],
        },
        critical_moments=[],
        themes=["development"],
        training_plan=[],
        limitations=[],
    )
    output = models.LlmOutput(
        scope_type="game",
        scope_id=game_id,
        input_hash=input_hash,
        model="gpt-5-mini",
        prompt_version=COACH_PROMPT_VERSION,
        schema_version=COACH_SCHEMA_VERSION,
        output_json=report.model_dump(),
    )
    session.add(output)
    session.commit()


def test_engine_job_processes_moves():
    ensure_stockfish_path()
    os.environ.setdefault("ENGINE_DEPTH", "4")
    os.environ.setdefault("ENGINE_TIME_MS", "50")
    os.environ.setdefault("ENGINE_MULTIPV", "1")

    with SessionLocal() as session:
        game_id = create_game(session)
        job = enqueue_engine_job(session, game_id=game_id, force=False, max_plies=4, max_attempts=1)
        processed = process_pending_jobs(session, limit=1)

        assert processed
        assert processed[0].id == job.id
        assert processed[0].status == JOB_STATUS_COMPLETED
        analyses = (
            session.query(models.MoveAnalysis)
            .join(models.Move, models.MoveAnalysis.move_id == models.Move.id)
            .filter(models.Move.game_id == game_id)
            .count()
        )
        assert analyses > 0


def test_coach_job_uses_cached_output():
    with SessionLocal() as session:
        game_id = create_game(session)
        question = "Summarize the main mistakes."
        seed_cached_report(session, game_id, question)

        job = enqueue_coach_job(
            session,
            game_id=game_id,
            question=question,
            analysis_version="Stockfish@local|depth=1|time_ms=10|multipv=1",
            force=False,
            max_moments=4,
            max_attempts=1,
        )
        processed = process_pending_jobs(session, limit=1)
        assert processed
        assert processed[0].id == job.id
        assert processed[0].status == JOB_STATUS_COMPLETED
        assert processed[0].result_json["cached"] is True
