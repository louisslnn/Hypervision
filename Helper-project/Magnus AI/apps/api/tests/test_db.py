from app.db.base import Base
from app.db.models import Game, Move, Player, SyncRun
from app.db.session import get_engine
from sqlalchemy.orm import Session


def test_sync_run_persists():
    engine = get_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        run = SyncRun(status="stub", sync_version="v0.1")
        session.add(run)
        session.commit()
        session.refresh(run)
        assert run.id is not None


def test_game_persists_with_player():
    engine = get_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        player = Player(username="tester")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = Game(
            player_id=player.id,
            uuid="game-uuid",
            chesscom_url="https://www.chess.com/game/live/123",
            ingest_version="v0.1",
        )
        session.add(game)
        session.commit()
        session.refresh(game)
        assert game.id is not None


def test_move_persists_with_game():
    engine = get_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        player = Player(username="tester")
        session.add(player)
        session.commit()
        session.refresh(player)

        game = Game(
            player_id=player.id,
            uuid="game-uuid-2",
            chesscom_url="https://www.chess.com/game/live/456",
            ingest_version="v0.1",
            pgn_raw='[Event "Test"]\n1. e4 e5 1/2-1/2',
        )
        session.add(game)
        session.commit()
        session.refresh(game)

        move = Move(
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
        assert move.id is not None
