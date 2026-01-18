import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _resolve_database_url(url: str) -> str:
    prefix = "sqlite:///./"
    if url.startswith(prefix):
        relative_path = url[len(prefix) :]
        project_root = Path(__file__).resolve().parents[4]
        absolute_path = (project_root / relative_path).resolve()
        return f"sqlite:///{absolute_path.as_posix()}"
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: str
    chesscom_base_url: str
    chesscom_user_agent: str
    stockfish_path: str
    engine_depth: int
    engine_time_ms: int
    engine_multipv: int
    openai_api_key: str
    openai_base_url: str
    openai_model: str
    openai_timeout: float


def get_settings() -> Settings:
    return Settings(
        database_url=_resolve_database_url(
            os.getenv("DATABASE_URL", "sqlite:///./apps/api/app.db")
        ),
        cors_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000"),
        chesscom_base_url=os.getenv("CHESSCOM_BASE_URL", "https://api.chess.com"),
        chesscom_user_agent=os.getenv("CHESSCOM_USER_AGENT", "MagnusAI/0.1 (contact@example.com)"),
        stockfish_path=os.getenv("STOCKFISH_PATH", "stockfish"),
        engine_depth=_get_int("ENGINE_DEPTH", 12),
        engine_time_ms=_get_int("ENGINE_TIME_MS", 1000),
        engine_multipv=_get_int("ENGINE_MULTIPV", 1),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com"),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
        openai_timeout=_get_float("OPENAI_TIMEOUT", 300.0),
    )
