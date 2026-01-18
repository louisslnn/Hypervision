import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hypervision/chess-domain": resolve(__dirname, "../../packages/chess-domain/src")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"]
  }
});
