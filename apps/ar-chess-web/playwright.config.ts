import { defineConfig } from "@playwright/test";

const parsedPort = Number(process.env.PLAYWRIGHT_PORT);
const port = Number.isFinite(parsedPort) ? parsedPort : 3100;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    permissions: ["camera"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    }
  },
  webServer: {
    command:
      `NEXT_PUBLIC_ENGINE=mock NEXT_PUBLIC_DISABLE_HANDS=true NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true NEXT_PUBLIC_FIREBASE_PROJECT_ID=hypervision-demo NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=8085 NEXT_PUBLIC_DEBUG_INPUT=true npx pnpm@9.12.0 exec next dev -p ${port}`,
    port,
    reuseExistingServer
  }
});
