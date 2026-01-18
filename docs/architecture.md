# HyperVision AR Architecture

## Overview
The monorepo follows a clean layering model:

- Domain: `packages/chess-domain` (pure chess logic + coach classification)
- Application/Adapters: `packages/ar-core`, `packages/engine`, `apps/firebase-functions`
- UI: `apps/ar-chess-web` and demo routes

Dependency direction:

- Adapters (Firebase, MediaPipe, Stockfish) depend on domain packages
- Domain packages never import browser APIs, CV libraries, or Firebase SDKs

## Key packages

- `packages/ar-core`: CV ports, gesture state machine, homography math
- `packages/chess-domain`: chess rules wrapper + canonical DTOs
- `packages/engine`: chess engine interface + adapters
- `apps/ar-chess-web`: Next.js UI composition
- `apps/firebase-functions`: authoritative move validation + persistence

## Ports & adapters

- CV: `HandTrackingPort` (MediaPipe adapter)
- Engine: `ChessEngine` (Stockfish WASM adapter, Starfish HTTP stub)
- Multiplayer: `SyncAdapter` (Firebase implementation)

## Privacy baseline

- No raw video frames are uploaded
- Only move events and game state stored in Firestore
