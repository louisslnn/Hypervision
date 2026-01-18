from app.core.config import get_settings
from app.core.constants import (
    COMMENTARY_WIZARD_PROMPT_VERSION,
    COMMENTARY_WIZARD_SCHEMA_VERSION,
    GAME_RECAP_PROMPT_VERSION,
    GAME_RECAP_SCHEMA_VERSION,
    INSIGHTS_COACH_PROMPT_VERSION,
    INSIGHTS_COACH_SCHEMA_VERSION,
    MOVE_COACH_PROMPT_VERSION,
    MOVE_COACH_SCHEMA_VERSION,
)
from app.db import models
from app.db.session import engine
from app.main import app
from app.schemas.coach import (
    CommentaryWizardReport,
    GameRecapReport,
    MoveCommentary,
    MoveCommentaryEvidence,
    MoveCommentaryReport,
)
from app.schemas.insights import InsightsCoachGuideline, InsightsCoachReport
from app.services.engine import hash_fen
from app.services.insights_coach import build_insights_coach_payload
from app.services.move_coach import (
    build_commentary_wizard_payload,
    build_game_recap_payload,
    build_input_hash,
    build_move_commentary_payload,
)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

client = TestClient(app)


def seed_game_with_analysis(username: str, analysis_version: str) -> int:
    with Session(engine) as session:
        player = models.Player(username=username)
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid=f"{username}-game-1",
            chesscom_url=f"https://www.chess.com/game/live/{hash(username) % 10000}",
            ingest_version="v0.1",
            time_control="300+2",
            time_class="blitz",
            white_username=username,
            black_username="opponent",
            result_white="win",
            result_black="checkmated",
        )
        session.add(game)
        session.commit()
        session.refresh(game)

        move_one = models.Move(
            game_id=game.id,
            ply=1,
            move_san="e4",
            move_uci="e2e4",
            fen_before="start",
            fen_after="after1",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=290000,
            time_spent_ms=1200,
        )
        move_two = models.Move(
            game_id=game.id,
            ply=2,
            move_san="e5",
            move_uci="e7e5",
            fen_before="after1",
            fen_after="after2",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=290000,
            time_spent_ms=900,
        )
        session.add_all([move_one, move_two])
        session.commit()
        session.refresh(move_one)
        session.refresh(move_two)

        analysis_one = models.MoveAnalysis(
            move_id=move_one.id,
            analysis_version=analysis_version,
            eval_before_cp=20,
            eval_before_mate=None,
            eval_after_cp=0,
            eval_after_mate=None,
            cpl=20,
            best_move_uci="e2e4",
            best_eval_cp=20,
            best_eval_mate=None,
            classification="good",
            tags_json=[],
        )
        analysis_two = models.MoveAnalysis(
            move_id=move_two.id,
            analysis_version=analysis_version,
            eval_before_cp=0,
            eval_before_mate=None,
            eval_after_cp=-30,
            eval_after_mate=None,
            cpl=30,
            best_move_uci="e7e5",
            best_eval_cp=0,
            best_eval_mate=None,
            classification="inaccuracy",
            tags_json=[],
        )
        session.add_all([analysis_one, analysis_two])

        for fen, pv in [("start", "e2e4"), ("after1", "e7e5")]:
            session.add(
                models.EnginePosition(
                    fen_hash=hash_fen(fen),
                    fen=fen,
                    side_to_move="w",
                    engine_name="Stockfish",
                    engine_version="test",
                    analysis_depth=1,
                    analysis_time_ms=10,
                    analysis_multipv=1,
                    analysis_version=analysis_version,
                    eval_cp=0,
                    eval_mate=None,
                    pv_uci=pv,
                    multipv_json=[],
                )
            )
        session.commit()

        return game.id


def test_move_commentary_and_recap_cached():
    analysis_version = "Stockfish@test|depth=1|time_ms=10|multipv=1"
    game_id = seed_game_with_analysis("move-coach-user", analysis_version)
    settings = get_settings()
    wizard_question = "Why is this a tactical threat?"

    with Session(engine) as session:
        payload, resolved_version = build_move_commentary_payload(
            session, game_id, analysis_version
        )
        input_hash = build_input_hash(
            "move_commentary",
            payload,
            settings.openai_model,
            prompt_version=MOVE_COACH_PROMPT_VERSION,
            schema_version=MOVE_COACH_SCHEMA_VERSION,
        )
        moves = session.query(models.Move).filter(models.Move.game_id == game_id).all()
        move_id = moves[0].id
        report = MoveCommentaryReport(
            game_id=game_id,
            analysis_version=analysis_version,
            summary=["Sharp opening choices."],
            themes=["development"],
            moves=[
                MoveCommentary(
                    move_id=moves[0].id,
                    ply=1,
                    move_san="e4",
                    move_uci="e2e4",
                    fen_hash=hash_fen("start"),
                    classification="good",
                    cpl=20,
                    clock_remaining_ms=290000,
                    time_spent_ms=1200,
                    explanation="Solid central space gain.",
                    focus_tags=["space"],
                    evidence=MoveCommentaryEvidence(
                        best_move_uci="e2e4",
                        eval_before_cp=20,
                        eval_before_mate=None,
                        eval_after_cp=0,
                        eval_after_mate=None,
                    ),
                ),
                MoveCommentary(
                    move_id=moves[1].id,
                    ply=2,
                    move_san="e5",
                    move_uci="e7e5",
                    fen_hash=hash_fen("after1"),
                    classification="inaccuracy",
                    cpl=30,
                    clock_remaining_ms=290000,
                    time_spent_ms=900,
                    explanation="Keeps symmetry but concedes a small edge.",
                    focus_tags=["symmetry"],
                    evidence=MoveCommentaryEvidence(
                        best_move_uci="e7e5",
                        eval_before_cp=0,
                        eval_before_mate=None,
                        eval_after_cp=-30,
                        eval_after_mate=None,
                    ),
                ),
            ],
            limitations=[],
        )
        output = models.LlmOutput(
            scope_type="move_commentary",
            scope_id=game_id,
            input_hash=input_hash,
            model=settings.openai_model,
            prompt_version=MOVE_COACH_PROMPT_VERSION,
            schema_version=MOVE_COACH_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        session.add(output)
        assert resolved_version == analysis_version

        recap_payload, recap_version = build_game_recap_payload(session, game_id, analysis_version)
        recap_hash = build_input_hash(
            "game_recap",
            recap_payload,
            settings.openai_model,
            prompt_version=GAME_RECAP_PROMPT_VERSION,
            schema_version=GAME_RECAP_SCHEMA_VERSION,
        )
        recap = GameRecapReport(
            game_id=game_id,
            analysis_version=analysis_version,
            summary=["A steady start with small inaccuracies."],
            key_moments=[
                {
                    "move_id": moves[1].id,
                    "ply": 2,
                    "move_san": "e5",
                    "classification": "inaccuracy",
                    "cpl": 30,
                    "explanation": "Symmetry gave White comfortable play.",
                    "evidence": {
                        "best_move_uci": "e7e5",
                        "eval_before_cp": 0,
                        "eval_before_mate": None,
                        "eval_after_cp": -30,
                        "eval_after_mate": None,
                    },
                }
            ],
            strengths=["Quick development."],
            weaknesses=["Over-simplified early."],
            training_focus=["Develop with tempo."],
            limitations=[],
        )
        recap_output = models.LlmOutput(
            scope_type="game_recap",
            scope_id=game_id,
            input_hash=recap_hash,
            model=settings.openai_model,
            prompt_version=GAME_RECAP_PROMPT_VERSION,
            schema_version=GAME_RECAP_SCHEMA_VERSION,
            output_json=recap.model_dump(),
        )
        session.add(recap_output)

        wizard_payload, _ = build_commentary_wizard_payload(
            session,
            game_id,
            move_id,
            analysis_version,
            wizard_question,
            report,
        )
        wizard_hash = build_input_hash(
            "commentary_wizard",
            wizard_payload,
            settings.openai_model,
            prompt_version=COMMENTARY_WIZARD_PROMPT_VERSION,
            schema_version=COMMENTARY_WIZARD_SCHEMA_VERSION,
        )
        wizard_report = CommentaryWizardReport(
            game_id=game_id,
            move_id=move_id,
            analysis_version=analysis_version,
            question=wizard_question,
            segments=[
                {"type": "text", "text": "The move creates a direct threat on the center."},
                {"type": "move", "san": "e4"},
                {"type": "text", "text": "After that push, space opens for development."},
            ],
            limitations=[],
        )
        wizard_output = models.LlmOutput(
            scope_type="commentary_wizard",
            scope_id=game_id,
            input_hash=wizard_hash,
            model=settings.openai_model,
            prompt_version=COMMENTARY_WIZARD_PROMPT_VERSION,
            schema_version=COMMENTARY_WIZARD_SCHEMA_VERSION,
            output_json=wizard_report.model_dump(),
        )
        session.add(wizard_output)
        session.commit()
        assert recap_version == analysis_version

    commentary_response = client.post(f"/api/games/{game_id}/commentary", json={})
    assert commentary_response.status_code == 200
    commentary_payload = commentary_response.json()
    assert commentary_payload["cached"] is True
    assert commentary_payload["report"]["moves"]

    recap_response = client.post(f"/api/games/{game_id}/recap", json={})
    assert recap_response.status_code == 200
    recap_payload = recap_response.json()
    assert recap_payload["cached"] is True
    assert recap_payload["report"]["summary"]

    wizard_response = client.post(
        f"/api/games/{game_id}/commentary/wizard",
        json={"question": wizard_question, "move_id": move_id, "analysis_version": analysis_version},
    )
    assert wizard_response.status_code == 200
    wizard_payload = wizard_response.json()
    assert wizard_payload["cached"] is True
    assert wizard_payload["report"]["segments"]


def test_insights_coach_cached():
    settings = get_settings()
    analysis_version = "v2"

    with Session(engine) as session:
        player = models.Player(username="insights-coach-user")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = models.Game(
            player_id=player.id,
            uuid="insights-coach-game-1",
            chesscom_url="https://www.chess.com/game/live/771",
            ingest_version="v0.1",
            time_control="300+0",
            time_class="blitz",
            white_username=player.username,
            black_username="opponent",
            result_white="win",
            result_black="checkmated",
        )
        session.add(game)
        session.commit()
        session.refresh(game)

        move = models.Move(
            game_id=game.id,
            ply=1,
            move_san="e4",
            move_uci="e2e4",
            fen_before="start",
            fen_after="after",
            is_check=False,
            is_mate=False,
            clock_remaining_ms=20000,
            time_spent_ms=1500,
        )
        session.add(move)
        session.commit()
        session.refresh(move)

        analysis = models.MoveAnalysis(
            move_id=move.id,
            analysis_version=analysis_version,
            eval_before_cp=0,
            eval_before_mate=None,
            eval_after_cp=-100,
            eval_after_mate=None,
            cpl=100,
            best_move_uci="e2e4",
            best_eval_cp=0,
            best_eval_mate=None,
            classification="mistake",
            tags_json=[],
        )
        session.add(analysis)
        session.commit()

        payload, resolved_version, player_id = build_insights_coach_payload(
            session, player.username, analysis_version, None, 30000
        )
        input_hash = build_input_hash(
            "insights_coach",
            payload,
            settings.openai_model,
            prompt_version=INSIGHTS_COACH_PROMPT_VERSION,
            schema_version=INSIGHTS_COACH_SCHEMA_VERSION,
        )
        report = InsightsCoachReport(
            player_username=player.username,
            analysis_version=analysis_version,
            summary=["Early inaccuracies under time pressure."],
            focus_areas=["time management"],
            guidelines=[
                InsightsCoachGuideline(
                    title="Stabilize time usage",
                    description="Spend a bit more time on opening moves.",
                    focus_tags=["time"],
                    evidence_game_ids=[game.id],
                    evidence_move_ids=[move.id],
                )
            ],
            training_plan=["Play slow openings in training mode."],
            limitations=[],
        )
        output = models.LlmOutput(
            scope_type="insights_coach",
            scope_id=player_id,
            input_hash=input_hash,
            model=settings.openai_model,
            prompt_version=INSIGHTS_COACH_PROMPT_VERSION,
            schema_version=INSIGHTS_COACH_SCHEMA_VERSION,
            output_json=report.model_dump(),
        )
        session.add(output)
        session.commit()
        assert resolved_version == analysis_version

    response = client.post(
        "/api/insights/coach",
        json={"username": "insights-coach-user", "threshold_ms": 30000},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["cached"] is True
    assert payload["report"]["guidelines"]
