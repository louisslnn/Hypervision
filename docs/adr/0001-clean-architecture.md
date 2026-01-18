# ADR 0001: Clean Architecture + Ports/Adapters

## Context
We need a monorepo that supports AR chess and additional CV modules with strict layering.

## Decision
- Domain logic lives in `packages/chess-domain` and contains pure functions only.
- CV, engine, and multiplayer integrations are isolated behind ports/adapters.
- UI apps compose adapters and domain logic without leaking infrastructure details.

## Consequences
- Domain stays testable and deterministic.
- Adapters can be swapped (MediaPipe, Stockfish, Firebase).
- Clear boundaries prevent accidental imports of browser or Firebase APIs in domain packages.
