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
  // GRAPH NODE TYPES: ask a trait from lib/graph/nodeTypes.ts, never compare a kind to its name,
  // so a new node type is one registry entry.
  {
    files: ["lib/graph/**/*.{ts,tsx}", "components/graph/**/*.{ts,tsx}"],
    ignores: ["lib/graph/nodeTypes.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["left", "right"].map((side) => ({
          selector: `BinaryExpression[operator=/^[!=]==?$/][${side}.property.name='kind'][${side === "left" ? "right" : "left"}.value=/^(unit|entity|page|domain)$/]`,
          message:
            "Compare node kinds through a trait in lib/graph/nodeTypes.ts (isContent, hasHubBody, centersGrouping, ...), not by name.",
        })),
      ],
    },
  },
  globalIgnores([".claude/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),
]);

export default eslintConfig;
