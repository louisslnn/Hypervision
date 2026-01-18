# Architecture

## Overview
- Monorepo with separate frontend and backend.
- Local-first: all data and analysis run locally.
- Strict boundary: UI does not call Chess.com or OpenAI directly.

## Layout
- `apps/web`: Next.js UI (no secrets)
- `apps/api`: FastAPI service (all external calls and secrets)
- `packages/shared`: shared TypeScript schemas for API responses

## Data flow (current)
1. UI calls `GET /api/health` for connectivity.
2. API runs `POST /api/sync` to pull Chess.com archives + monthly game data.
3. API stores raw monthly JSON with ETag/Last-Modified metadata and upserts game records.
4. API runs `POST /api/games/{id}/parse` to parse PGN into move-level records.
5. API runs `POST /api/games/{id}/analyze` to store engine evaluations and move analysis.
6. API tracks each sync run with counts and status.

## Data flow (planned)
- Chess.com PubAPI ingestion -> raw storage -> PGN parsing -> engine analysis -> LLM narrative.

## Compliance
- Post-game analysis only.
- No Chess.com branding or assets.
- Secrets server-side only.
