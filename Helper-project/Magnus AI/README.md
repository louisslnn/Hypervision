# Magnus AI (local-first chess coaching)

Post-game chess analysis and coaching built on public Chess.com data. This repo is local-first and is not affiliated with Chess.com.

## Requirements
- Node.js 20+
- Python 3.11+
- SQLite (bundled with Python)

## Setup
1. Copy env settings:
   ```bash
   cp .env.example .env
   ```
2. Add your OpenAI API key to `.env` (this file stays local and is gitignored).
3. Install dependencies:
   ```bash
   npm install
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r apps/api/requirements-dev.txt
   ```
4. Install Stockfish and set `STOCKFISH_PATH` if needed (defaults to `stockfish` on PATH).
5. Apply the initial DB migration:
   ```bash
   npm run api:migrate
   ```

## Run locally
- API (FastAPI):
  ```bash
  source .venv/bin/activate
  npm run api:dev
  ```
- Web (Next.js):
  ```bash
  npm run web:dev
  ```

## Sync games
Trigger a sync for a Chess.com username (finished games only):
```bash
curl -X POST http://localhost:8000/api/sync \
  -H 'Content-Type: application/json' \
  -d '{"username":"your_username"}'
```

Parse a game's PGN into move records:
```bash
curl -X POST http://localhost:8000/api/games/1/parse
```

## Quality gates
```bash
npm run ci
```

## Safety and compliance
- Post-game analysis only. Do not use during live play.
- Public data only; respect Chess.com published-data caching and rate limits.
- No Chess.com assets or branding used here.

## Repository layout
- `apps/web`: Next.js UI
- `apps/api`: FastAPI service, DB, and analysis pipeline
- `packages/shared`: shared types/schemas
- `docs`: architecture, API, data model, and prompt specs
