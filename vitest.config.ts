import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// TEST RUNNER: node environment; the DB tests start their own Postgres, so allow time
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
