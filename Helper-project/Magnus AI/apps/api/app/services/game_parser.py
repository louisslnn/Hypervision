from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import models
from app.services.pgn import build_moves_from_pgn


def count_game_moves(db: Session, game_id: int) -> int:
    stmt = select(func.count(models.Move.id)).where(models.Move.game_id == game_id)
    return int(db.execute(stmt).scalar() or 0)


def parse_game_moves(db: Session, game: models.Game, force: bool = False) -> tuple[int, int]:
    if not game.pgn_raw:
        raise ValueError("Game has no PGN to parse.")
    if game.id is None:
        raise ValueError("Game must be persisted before parsing moves.")

    existing = count_game_moves(db, game.id)
    if existing and not force:
        return 0, existing

    if force and existing:
        db.execute(delete(models.Move).where(models.Move.game_id == game.id))

    parsed_moves = build_moves_from_pgn(game.pgn_raw, game.time_control)
    for move in parsed_moves:
        db.add(
            models.Move(
                game_id=game.id,
                ply=move.ply,
                move_san=move.move_san,
                move_uci=move.move_uci,
                fen_before=move.fen_before,
                fen_after=move.fen_after,
                is_check=move.is_check,
                is_mate=move.is_mate,
                capture_piece=move.capture_piece,
                promotion=move.promotion,
                clock_remaining_ms=move.clock_remaining_ms,
                time_spent_ms=move.time_spent_ms,
            )
        )

    return len(parsed_moves), existing


def get_game_by_id(db: Session, game_id: int) -> Optional[models.Game]:
    stmt = select(models.Game).where(models.Game.id == game_id)
    return db.execute(stmt).scalars().first()
