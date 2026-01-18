# HyperVision AR Chess Coach

Monorepo for AR chess and additional AR/CV demo modules.

## Quick start

1. Install dependencies
   - `pnpm install`
2. Run Firebase emulators
   - `pnpm emulators`
3. Start the web app
   - `pnpm dev`

## Structure

- `apps/ar-chess-web`: Next.js UI
- `apps/firebase-functions`: Firestore + Functions
- `packages/ar-core`: CV + projection + gesture state machine
- `packages/chess-domain`: chess rules + coach classification
- `packages/engine`: Stockfish + Starfish adapters
- `packages/modules`: additional AR/CV demos
- `docs`: architecture + runbook + demo script
