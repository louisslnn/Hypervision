import hashlib
from typing import Optional

from app.schemas.games import GameOut


def hash_username(username: str) -> str:
    digest = hashlib.sha256(username.encode("utf-8")).hexdigest()[:12]
    return f"anon-{digest}"


def anonymize_game(game: GameOut, player_username: Optional[str]) -> GameOut:
    def mask(value: Optional[str]) -> Optional[str]:
        return hash_username(value) if value else None

    white = game.white_username
    black = game.black_username

    if player_username:
        if white == player_username:
            return game.model_copy(update={"white_username": white, "black_username": mask(black)})
        if black == player_username:
            return game.model_copy(update={"white_username": mask(white), "black_username": black})

    return game.model_copy(update={"white_username": mask(white), "black_username": mask(black)})
