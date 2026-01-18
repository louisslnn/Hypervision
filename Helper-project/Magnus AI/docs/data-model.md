# Data Model (current)

## sync_runs
Tracks sync attempts and ingest counts.

Columns:
- `id` (integer, primary key)
- `status` (string)
- `player_username` (string, nullable)
- `sync_version` (string)
- `archives_total` (integer)
- `months_fetched` (integer)
- `months_not_modified` (integer)
- `games_upserted` (integer)
- `games_skipped` (integer)
- `error_message` (text, nullable)
- `created_at` (timestamp)
- `finished_at` (timestamp, nullable)

## players
Stores Chess.com usernames.

Columns:
- `id` (integer, primary key)
- `username` (string, unique)
- `created_at` (timestamp)

## raw_ingest
Stores raw monthly Chess.com JSON payloads with caching metadata.

Columns:
- `id` (integer, primary key)
- `player_id` (integer, foreign key)
- `year` (integer)
- `month` (integer)
- `endpoint` (string)
- `status_code` (integer)
- `not_modified` (boolean)
- `etag` (string, nullable)
- `last_modified` (string, nullable)
- `payload_json` (json, nullable)
- `fetched_at` (timestamp)
- `ingest_version` (string)

## games
Stores game metadata and raw PGN per game.

Columns:
- `id` (integer, primary key)
- `player_id` (integer, foreign key)
- `uuid` (string, unique)
- `chesscom_url` (string, unique)
- `start_time` (timestamp, nullable)
- `end_time` (timestamp, nullable)
- `time_control` (string, nullable)
- `time_class` (string, nullable)
- `rated` (boolean, nullable)
- `rules` (string, nullable)
- `white_username` (string, nullable)
- `black_username` (string, nullable)
- `white_rating_post` (integer, nullable)
- `black_rating_post` (integer, nullable)
- `result_white` (string, nullable)
- `result_black` (string, nullable)
- `pgn_raw` (text, nullable)
- `eco_url` (string, nullable)
- `ingest_version` (string)
- `created_at` (timestamp)

## moves
Stores parsed move data, FEN reconstruction, and clock metrics.

Columns:
- `id` (integer, primary key)
- `game_id` (integer, foreign key)
- `ply` (integer, unique per game)
- `move_san` (string)
- `move_uci` (string)
- `fen_before` (string)
- `fen_after` (string)
- `is_check` (boolean)
- `is_mate` (boolean)
- `capture_piece` (string, nullable)
- `promotion` (string, nullable)
- `clock_remaining_ms` (integer, nullable)
- `time_spent_ms` (integer, nullable)
- `created_at` (timestamp)

## engine_positions
Caches engine evaluations per position (FEN) and analysis version.

Columns:
- `id` (integer, primary key)
- `fen_hash` (string, sha256)
- `fen` (string)
- `side_to_move` (string)
- `engine_name` (string)
- `engine_version` (string)
- `analysis_depth` (integer)
- `analysis_time_ms` (integer)
- `analysis_multipv` (integer)
- `analysis_version` (string)
- `eval_cp` (integer, nullable)
- `eval_mate` (integer, nullable)
- `pv_uci` (text, nullable)
- `multipv_json` (json, nullable)
- `created_at` (timestamp)

## move_analysis
Stores per-move engine deltas and classification.

Columns:
- `id` (integer, primary key)
- `move_id` (integer, foreign key)
- `analysis_version` (string)
- `eval_before_cp` (integer, nullable)
- `eval_before_mate` (integer, nullable)
- `eval_after_cp` (integer, nullable)
- `eval_after_mate` (integer, nullable)
- `cpl` (integer, nullable)
- `best_move_uci` (string, nullable)
- `best_eval_cp` (integer, nullable)
- `best_eval_mate` (integer, nullable)
- `classification` (string)
- `tags_json` (json, nullable)
- `created_at` (timestamp)

## llm_outputs
Stores structured coach outputs with versioning and input hashes.

Columns:
- `id` (integer, primary key)
- `scope_type` (string)
- `scope_id` (integer)
- `input_hash` (string, sha256)
- `model` (string)
- `prompt_version` (string)
- `schema_version` (string)
- `output_json` (json)
- `created_at` (timestamp)

## patterns
Pattern library entries computed per player and analysis version.

Columns:
- `id` (integer, primary key)
- `player_id` (integer, foreign key)
- `analysis_version` (string)
- `pattern_key` (string)
- `title` (string)
- `description` (text)
- `severity_score` (float)
- `occurrences` (integer)
- `average_cpl` (float, nullable)
- `created_at` (timestamp)

## pattern_examples
Examples that ground each pattern to a concrete position.

Columns:
- `id` (integer, primary key)
- `pattern_id` (integer, foreign key)
- `game_id` (integer, foreign key)
- `move_id` (integer, foreign key)
- `fen` (string)
- `notes` (text, nullable)
- `created_at` (timestamp)

## jobs
Background job queue for engine and coach processing.

Columns:
- `id` (integer, primary key)
- `job_type` (string)
- `status` (string)
- `payload_json` (json)
- `result_json` (json, nullable)
- `error_message` (text, nullable)
- `attempts` (integer)
- `max_attempts` (integer)
- `run_at` (timestamp)
- `created_at` (timestamp)
- `started_at` (timestamp, nullable)
- `finished_at` (timestamp, nullable)
- `dedupe_key` (string, nullable, unique)
