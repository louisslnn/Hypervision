from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)

from app.db.base import Base


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(String(32), nullable=False)
    player_username = Column(String(64), nullable=True)
    sync_version = Column(String(32), nullable=False)
    archives_total = Column(Integer, nullable=False, server_default="0")
    months_fetched = Column(Integer, nullable=False, server_default="0")
    months_not_modified = Column(Integer, nullable=False, server_default="0")
    games_upserted = Column(Integer, nullable=False, server_default="0")
    games_skipped = Column(Integer, nullable=False, server_default="0")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RawIngest(Base):
    __tablename__ = "raw_ingest"

    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    endpoint = Column(String(32), nullable=False)
    status_code = Column(Integer, nullable=False)
    not_modified = Column(Boolean, nullable=False, server_default="0")
    etag = Column(String(255), nullable=True)
    last_modified = Column(String(255), nullable=True)
    payload_json = Column(JSON, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ingest_version = Column(String(32), nullable=False)


class Game(Base):
    __tablename__ = "games"

    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    uuid = Column(String(64), unique=True, nullable=False)
    chesscom_url = Column(String(255), unique=True, nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=True)
    end_time = Column(DateTime(timezone=True), nullable=True)
    time_control = Column(String(32), nullable=True)
    time_class = Column(String(32), nullable=True)
    rated = Column(Boolean, nullable=True)
    rules = Column(String(16), nullable=True)
    white_username = Column(String(64), nullable=True)
    black_username = Column(String(64), nullable=True)
    white_rating_post = Column(Integer, nullable=True)
    black_rating_post = Column(Integer, nullable=True)
    result_white = Column(String(16), nullable=True)
    result_black = Column(String(16), nullable=True)
    pgn_raw = Column(Text, nullable=True)
    eco_url = Column(String(255), nullable=True)
    ingest_version = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Move(Base):
    __tablename__ = "moves"
    __table_args__ = (UniqueConstraint("game_id", "ply", name="uq_moves_game_ply"),)

    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False, index=True)
    ply = Column(Integer, nullable=False)
    move_san = Column(String(32), nullable=False)
    move_uci = Column(String(16), nullable=False)
    fen_before = Column(String(100), nullable=False)
    fen_after = Column(String(100), nullable=False)
    is_check = Column(Boolean, nullable=False, server_default="0")
    is_mate = Column(Boolean, nullable=False, server_default="0")
    capture_piece = Column(String(8), nullable=True)
    promotion = Column(String(8), nullable=True)
    clock_remaining_ms = Column(Integer, nullable=True)
    time_spent_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class EnginePosition(Base):
    __tablename__ = "engine_positions"
    __table_args__ = (
        UniqueConstraint(
            "fen_hash",
            "analysis_version",
            name="uq_engine_positions_fen_hash_version",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    fen_hash = Column(String(64), nullable=False, index=True)
    fen = Column(String(100), nullable=False)
    side_to_move = Column(String(1), nullable=False)
    engine_name = Column(String(64), nullable=False)
    engine_version = Column(String(32), nullable=False)
    analysis_depth = Column(Integer, nullable=False)
    analysis_time_ms = Column(Integer, nullable=False)
    analysis_multipv = Column(Integer, nullable=False)
    analysis_version = Column(String(128), nullable=False)
    eval_cp = Column(Integer, nullable=True)
    eval_mate = Column(Integer, nullable=True)
    pv_uci = Column(Text, nullable=True)
    multipv_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MoveAnalysis(Base):
    __tablename__ = "move_analysis"
    __table_args__ = (
        UniqueConstraint("move_id", "analysis_version", name="uq_move_analysis_move_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    move_id = Column(Integer, ForeignKey("moves.id"), nullable=False, index=True)
    analysis_version = Column(String(128), nullable=False)
    eval_before_cp = Column(Integer, nullable=True)
    eval_before_mate = Column(Integer, nullable=True)
    eval_after_cp = Column(Integer, nullable=True)
    eval_after_mate = Column(Integer, nullable=True)
    cpl = Column(Integer, nullable=True)
    best_move_uci = Column(String(16), nullable=True)
    best_eval_cp = Column(Integer, nullable=True)
    best_eval_mate = Column(Integer, nullable=True)
    classification = Column(String(16), nullable=False)
    tags_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LlmOutput(Base):
    __tablename__ = "llm_outputs"
    __table_args__ = (
        UniqueConstraint("scope_type", "scope_id", "input_hash", name="uq_llm_outputs_scope_hash"),
    )

    id = Column(Integer, primary_key=True, index=True)
    scope_type = Column(String(32), nullable=False, index=True)
    scope_id = Column(Integer, nullable=False, index=True)
    input_hash = Column(String(64), nullable=False)
    model = Column(String(64), nullable=False)
    prompt_version = Column(String(32), nullable=False)
    schema_version = Column(String(32), nullable=False)
    output_json = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Pattern(Base):
    __tablename__ = "patterns"
    __table_args__ = (
        UniqueConstraint(
            "player_id",
            "analysis_version",
            "pattern_key",
            name="uq_patterns_player_version_key",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    analysis_version = Column(String(128), nullable=False, index=True)
    pattern_key = Column(String(64), nullable=False)
    title = Column(String(128), nullable=False)
    description = Column(Text, nullable=False)
    severity_score = Column(Float, nullable=False, server_default="0")
    occurrences = Column(Integer, nullable=False, server_default="0")
    average_cpl = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PatternExample(Base):
    __tablename__ = "pattern_examples"
    __table_args__ = (
        UniqueConstraint("pattern_id", "move_id", name="uq_pattern_examples_pattern_move"),
    )

    id = Column(Integer, primary_key=True, index=True)
    pattern_id = Column(Integer, ForeignKey("patterns.id"), nullable=False, index=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False, index=True)
    move_id = Column(Integer, ForeignKey("moves.id"), nullable=False, index=True)
    fen = Column(String(100), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("dedupe_key", name="uq_jobs_dedupe_key"),)

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(String(32), nullable=False, index=True)
    status = Column(String(16), nullable=False, index=True)
    payload_json = Column(JSON, nullable=False)
    result_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    attempts = Column(Integer, nullable=False, server_default="0")
    max_attempts = Column(Integer, nullable=False, server_default="3")
    run_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    dedupe_key = Column(String(128), nullable=True, unique=True)
