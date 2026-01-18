# Runbook

## Local development

1. Install dependencies
   - `pnpm install`
2. Start Firebase emulators
   - `pnpm emulators`
3. Run the web app
   - `pnpm dev`

### Coach (LLM)

The coach explanation service uses OpenAI. Set these locally (do not commit secrets):

- `OPENAI_API_KEY=...`
- `OPENAI_MODEL=gpt-5.1-mini` (optional)

### Firebase Admin (service account)

The service account key lives at `apps/firebase-functions/serviceAccountKey.json` (gitignored). It is used by the Firebase Admin SDK in `firebase-functions` when running against real Firebase.

- **Emulators only:** no extra setup; the Functions emulator uses emulated Firestore/Auth.
- **Real Firebase from local:** set `GOOGLE_APPLICATION_CREDENTIALS` to the key path, e.g.  
  `export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/apps/firebase-functions/serviceAccountKey.json`

## Quality checks

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## E2E tests

- `pnpm --filter @hypervision/ar-chess-web test:e2e`

## Emulator smoke

- `firebase emulators:start`
