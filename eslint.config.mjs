import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { standardLint } from "./lib/standard-lint.mjs";

// LINT RULES: Next's recommended sets, the standards in the README, and
// jayrr.dev's standard lint (theme colors only, sizes through props) on our ui alias.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  ...standardLint({ ui: "@/components/ui" }),
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),
]);

export default eslintConfig;
