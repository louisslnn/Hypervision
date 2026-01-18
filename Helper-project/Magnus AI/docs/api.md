# API

Base URL: `http://localhost:8000`

## Health
`GET /api/health`

Response:
```json
{
  "status": "ok",
  "db": "ok"
}
```

## Sync
`POST /api/sync`

Request:
```json
{
  "username": "example_user"
}
```

Response:
```json
{
  "id": 1,
  "status": "completed",
  "player_username": "example_user",
  "sync_version": "v0.1",
  "archives_total": 12,
  "months_fetched": 3,
  "months_not_modified": 9,
  "games_upserted": 42,
  "games_skipped": 0,
  "error_message": null,
  "created_at": "2025-01-07T18:10:00Z",
  "finished_at": "2025-01-07T18:10:05Z"
}
```

`GET /api/sync/status`

Response:
```json
{
  "status": "ok",
  "last_run": {
    "id": 1,
    "status": "completed",
    "player_username": "example_user",
    "sync_version": "v0.1",
    "archives_total": 12,
    "months_fetched": 3,
    "months_not_modified": 9,
    "games_upserted": 42,
    "games_skipped": 0,
    "error_message": null,
    "created_at": "2025-01-07T18:10:00Z",
    "finished_at": "2025-01-07T18:10:05Z"
  }
}
```

## Games
`GET /api/games`

Optional query params:
- `username`
- `time_class`
- `result` (requires `username`)
- `color` (requires `username`, `white` or `black`)
- `opening` (substring match on `eco_url`)
- `opponent_rating_min` / `opponent_rating_max` (requires `username`)
- `date_from` / `date_to` (ISO timestamps)
- `limit`
- `anonymize` (boolean, hash opponent usernames for screenshots/demo)

Response:
```json
[
  {
    "id": 1,
    "uuid": "game-uuid",
    "chesscom_url": "https://www.chess.com/game/live/123",
    "start_time": "2025-01-07T18:00:00Z",
    "end_time": "2025-01-07T18:10:00Z",
    "time_control": "600+5",
    "time_class": "rapid",
    "rated": true,
    "rules": "chess",
    "white_username": "player",
    "black_username": "opponent",
    "white_rating_post": 1500,
    "black_rating_post": 1490,
    "result_white": "win",
    "result_black": "resigned",
    "eco_url": "https://www.chess.com/openings/Queens-Pawn-Opening",
    "created_at": "2025-01-07T18:10:05Z"
  }
]
```

`GET /api/games/{game_id}`

Optional query params:
- `anonymize` (boolean, hash opponent usernames for screenshots/demo)

Response:
```json
{
  "id": 1,
  "uuid": "game-uuid",
  "chesscom_url": "https://www.chess.com/game/live/123",
  "start_time": "2025-01-07T18:00:00Z",
  "end_time": "2025-01-07T18:10:00Z",
  "time_control": "600+5",
  "time_class": "rapid",
  "rated": true,
  "rules": "chess",
  "white_username": "player",
  "black_username": "opponent",
  "white_rating_post": 1500,
  "black_rating_post": 1490,
  "result_white": "win",
  "result_black": "resigned",
  "eco_url": "https://www.chess.com/openings/Queens-Pawn-Opening",
  "created_at": "2025-01-07T18:10:05Z"
}
```

`GET /api/games/{game_id}/pgn`

Response:
```json
{
  "game_id": 1,
  "pgn": "[Event \"Test\"]\n1. e4 e5 1/2-1/2"
}
```

`GET /api/games/{game_id}/moves`

Response:
```json
[
  {
    "id": 10,
    "game_id": 1,
    "ply": 1,
    "move_san": "e4",
    "move_uci": "e2e4",
    "fen_before": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "fen_after": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    "is_check": false,
    "is_mate": false,
    "capture_piece": null,
    "promotion": null,
    "clock_remaining_ms": 300000,
    "time_spent_ms": 2000,
    "created_at": "2025-01-07T18:10:05Z"
  }
]
```

`POST /api/games/{game_id}/parse?force=false`

Response:
```json
{
  "status": "ok",
  "moves_created": 42,
  "moves_existing": 0
}
```

## Analysis
`POST /api/games/{game_id}/analyze`

Request:
```json
{
  "force": false,
  "max_plies": 80
}
```

Response:
```json
{
  "status": "ok",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "engine_name": "Stockfish",
  "engine_version": "unknown",
  "analysis_depth": 12,
  "analysis_time_ms": 1000,
  "analysis_multipv": 1,
  "moves_analyzed": 40,
  "moves_skipped": 0
}
```

`GET /api/games/{game_id}/analysis`

Response:
```json
{
  "status": "ok",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "engine_name": "Stockfish",
  "engine_version": "unknown",
  "analysis_depth": 12,
  "analysis_time_ms": 1000,
  "analysis_multipv": 1,
  "move_count": 40,
  "critical_moments": [
    {
      "move_id": 101,
      "ply": 18,
      "move_san": "Qxd4",
      "fen_before": "r1bqk2r/ppp2ppp/2n2n2/3pp3/3P4/2P2N2/PP1NPPPP/R1BQKB1R w KQkq - 0 6",
      "cpl": 320,
      "classification": "blunder",
      "best_move_uci": "d4e5",
      "eval_before": { "eval_cp": 20, "eval_mate": null },
      "eval_after": { "eval_cp": -280, "eval_mate": null }
    }
  ]
}
```

`GET /api/games/{game_id}/analysis/series`

Response:
```json
{
  "status": "ok",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "series": [
    {
      "move_id": 10,
      "ply": 1,
      "move_san": "e4",
      "move_uci": "e2e4",
      "fen_before": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "fen_after": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      "eval_before": { "eval_cp": 20, "eval_mate": null },
      "eval_after": { "eval_cp": 30, "eval_mate": null },
      "cpl": 0,
      "classification": "best",
      "best_move_uci": "e2e4",
      "clock_remaining_ms": 300000,
      "time_spent_ms": 2000
    }
  ]
}
```

`GET /api/moves/{move_id}/analysis`

Response:
```json
{
  "id": 1,
  "move_id": 101,
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "eval_before": { "eval_cp": 20, "eval_mate": null },
  "eval_after": { "eval_cp": -280, "eval_mate": null },
  "cpl": 300,
  "best_move_uci": "d4e5",
  "best_eval": { "eval_cp": 20, "eval_mate": null },
  "classification": "blunder",
  "tags": [],
  "created_at": "2025-01-12T00:00:00Z"
}
```

## Insights
`GET /api/insights/overview?username={username}`

Response:
```json
{
  "status": "ok",
  "player_username": "example_user",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "games": 12,
  "moves_analyzed": 420,
  "average_cpl": 45.2,
  "blunders": 8,
  "mistakes": 21,
  "inaccuracies": 38,
  "last_sync": "2025-01-07T18:10:05Z"
}
```

`GET /api/insights/openings?username={username}`

Response:
```json
{
  "status": "ok",
  "player_username": "example_user",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "openings": [
    {
      "opening": "https://www.chess.com/openings/Sicilian-Defense",
      "games": 6,
      "wins": 4,
      "losses": 1,
      "draws": 1,
      "win_rate": 0.66,
      "average_cpl": 38.1
    }
  ]
}
```

`GET /api/insights/time?username={username}&threshold_ms=30000`

Response:
```json
{
  "status": "ok",
  "player_username": "example_user",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "time_trouble_threshold_ms": 30000,
  "avg_time_spent_ms": 4200,
  "time_trouble_moves": 12,
  "time_trouble_blunders": 3,
  "avg_cpl_time_trouble": 110.4,
  "avg_cpl_normal": 35.2
}
```

`GET /api/insights/patterns?username={username}`

Response:
```json
{
  "status": "ok",
  "player_username": "example_user",
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "patterns": [
    {
      "pattern_key": "blunder",
      "title": "Time trouble blunders",
      "description": "Mistakes and blunders played under low remaining clock.",
      "occurrences": 8,
      "average_cpl": 420.5,
      "severity_score": 0.92,
      "examples": [
        {
          "game_id": 1,
          "move_id": 101,
          "fen": "r1bqk2r/ppp2ppp/2n2n2/3pp3/3P4/2P2N2/PP1NPPPP/R1BQKB1R w KQkq - 0 6",
          "notes": "Clock 12000 ms"
        }
      ]
    }
  ]
}
```

## Coach
`POST /api/coach/query`

Request:
```json
{
  "question": "Summarize the main mistakes and what to train.",
  "game_id": 1,
  "analysis_version": null,
  "force": false,
  "max_moments": 8
}
```

## Jobs
`POST /api/jobs/engine`

Request:
```json
{
  "game_id": 1,
  "force": false,
  "max_plies": 80,
  "max_attempts": 3
}
```

`POST /api/jobs/coach`

Request:
```json
{
  "game_id": 1,
  "question": "Summarize the game.",
  "analysis_version": null,
  "force": false,
  "max_moments": 8,
  "max_attempts": 3
}
```

`GET /api/jobs/{job_id}`

Response:
```json
{
  "id": 10,
  "job_type": "engine_analysis",
  "status": "queued",
  "attempts": 0,
  "max_attempts": 3,
  "payload_json": { "game_id": 1, "force": false, "max_plies": 80 },
  "result_json": null,
  "error_message": null,
  "created_at": "2025-01-12T00:00:00Z",
  "started_at": null,
  "finished_at": null,
  "run_at": "2025-01-12T00:00:00Z",
  "dedupe_key": "engine:1:max_plies=80"
}
```

Response:
```json
{
  "status": "ok",
  "scope_type": "game",
  "scope_id": 1,
  "analysis_version": "Stockfish@unknown|depth=12|time_ms=1000|multipv=1",
  "model": "gpt-5-mini",
  "prompt_version": "v0.1",
  "schema_version": "v0.1",
  "output_id": 7,
  "cached": false,
  "created_at": "2025-01-12T00:00:00Z",
  "report": {
    "summary": ["You lost material in tactical skirmishes."],
    "phase_advice": {
      "opening": ["Finish development before grabbing pawns."],
      "middlegame": ["Watch loose pieces after exchanges."],
      "endgame": ["Simplify when ahead in material."]
    },
    "critical_moments": [
      {
        "move_id": 101,
        "ply": 18,
        "fen_hash": "deadbeef",
        "move_san": "Qxd4",
        "classification": "blunder",
        "cpl": 320,
        "explanation": "Move allows a tactical reply based on the engine PV.",
        "evidence": {
          "best_move_uci": "d4e5",
          "eval_before_cp": 20,
          "eval_before_mate": null,
          "eval_after_cp": -280,
          "eval_after_mate": null
        },
        "what_to_train": ["Loose piece tactics"]
      }
    ],
    "themes": ["tactical oversights"],
    "training_plan": [
      {
        "title": "Loose piece drills",
        "description": "Solve 10 LPT puzzles.",
        "focus_tags": ["tactics"],
        "related_move_ids": [101],
        "time_estimate_min": 20
      }
    ],
    "limitations": []
  }
}
```

## Privacy
`DELETE /api/data/purge`

Response:
```json
{
  "status": "ok",
  "deleted": {
    "move_analysis": 42,
    "engine_positions": 84,
    "moves": 42,
    "games": 1,
    "raw_ingest": 1,
    "sync_runs": 1,
    "llm_outputs": 1,
    "players": 1
  }
}
```
