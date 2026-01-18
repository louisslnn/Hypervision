from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Generator, Optional

import chess
import chess.engine

from app.core.config import get_settings

MATE_SCORE_CP = 100000


@dataclass(frozen=True)
class EngineConfig:
    path: str
    depth: int
    time_ms: int
    multipv: int


@dataclass(frozen=True)
class EngineMetadata:
    name: str
    version: str
    depth: int
    time_ms: int
    multipv: int

    @property
    def analysis_version(self) -> str:
        name = self.name.replace(" ", "_")
        version = self.version.replace(" ", "_")
        return f"{name}@{version}|depth={self.depth}|time_ms={self.time_ms}|multipv={self.multipv}"


@dataclass(frozen=True)
class EngineLine:
    eval_cp: Optional[int]
    eval_mate: Optional[int]
    pv_uci: Optional[str]
    depth: Optional[int]


@dataclass(frozen=True)
class EngineEvaluation:
    eval_cp: Optional[int]
    eval_mate: Optional[int]
    pv_uci: Optional[str]
    multipv: list[EngineLine]


def hash_fen(fen: str) -> str:
    return hashlib.sha256(fen.encode("utf-8")).hexdigest()


def score_to_eval(score: Optional[chess.engine.PovScore]) -> tuple[Optional[int], Optional[int]]:
    if score is None:
        return None, None
    white_score = score.white()
    mate = white_score.mate()
    if mate is not None:
        return None, int(mate)
    cp = white_score.score()
    return int(cp) if cp is not None else None, None


def info_to_line(info: chess.engine.InfoDict) -> EngineLine:
    eval_cp, eval_mate = score_to_eval(info.get("score"))
    pv = info.get("pv") or []
    pv_uci = " ".join(move.uci() for move in pv) if pv else None
    depth = info.get("depth")
    return EngineLine(eval_cp=eval_cp, eval_mate=eval_mate, pv_uci=pv_uci, depth=depth)


def normalize_info(info: object) -> list[EngineLine]:
    if isinstance(info, list):
        lines = [info_to_line(item) for item in info]
        return [
            line
            for line in lines
            if line.pv_uci or line.eval_cp is not None or line.eval_mate is not None
        ]
    if isinstance(info, dict):
        return [info_to_line(info)]
    return []


class StockfishEngineEvaluator:
    def __init__(self, config: EngineConfig) -> None:
        self.config = config
        self._engine: Optional[chess.engine.SimpleEngine] = None
        self.metadata: Optional[EngineMetadata] = None

    def __enter__(self) -> "StockfishEngineEvaluator":
        self._engine = chess.engine.SimpleEngine.popen_uci(self.config.path)
        name = self._engine.id.get("name", "Stockfish")
        version = self._engine.id.get("version") or "unknown"
        self.metadata = EngineMetadata(
            name=name,
            version=version,
            depth=self.config.depth,
            time_ms=self.config.time_ms,
            multipv=self.config.multipv,
        )
        return self

    def __exit__(self, exc_type, exc, exc_tb) -> None:
        if self._engine:
            self._engine.quit()
        self._engine = None
        self.metadata = None

    def analyze(self, fen: str) -> EngineEvaluation:
        if not self._engine or not self.metadata:
            raise RuntimeError("Engine evaluator is not initialized.")
        board = chess.Board(fen)
        limit = chess.engine.Limit(
            depth=self.metadata.depth if self.metadata.depth > 0 else None,
            time=self.metadata.time_ms / 1000 if self.metadata.time_ms > 0 else None,
        )
        info = self._engine.analyse(board, limit, multipv=max(self.metadata.multipv, 1))
        lines = normalize_info(info)
        if not lines:
            return EngineEvaluation(eval_cp=None, eval_mate=None, pv_uci=None, multipv=[])
        top = lines[0]
        return EngineEvaluation(
            eval_cp=top.eval_cp,
            eval_mate=top.eval_mate,
            pv_uci=top.pv_uci,
            multipv=lines,
        )


def get_engine_config() -> EngineConfig:
    settings = get_settings()
    return EngineConfig(
        path=settings.stockfish_path,
        depth=settings.engine_depth,
        time_ms=settings.engine_time_ms,
        multipv=settings.engine_multipv,
    )


def get_engine_evaluator() -> Generator[StockfishEngineEvaluator, None, None]:
    config = get_engine_config()
    with StockfishEngineEvaluator(config) as evaluator:
        yield evaluator
