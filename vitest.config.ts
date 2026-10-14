import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// TEST RUNNER: node environment; the DB tests start their own Postgres, so allow time
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".claude/**"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
