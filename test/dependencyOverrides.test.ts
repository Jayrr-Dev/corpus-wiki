import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs.js") as {
  getRootDirs: (context: { cwd: string; settings: { next?: { rootDir: string | string[] } } }) => string[];
};

// These exercise the actual consumers, rather than just the replacement APIs.
// Remove the overrides when upstream drops the affected dependencies:
// GHSA-vfj7-8cjw-p6xm (braces), GHSA-hp3w-g68c-fv3c (sprintf-js).
describe("security dependency overrides", () => {
  it("keeps the default Next lint root", () => {
    expect(getRootDirs({ cwd: process.cwd(), settings: {} })).toEqual([process.cwd()]);
  });

  it("resolves brace patterns and only directories for Next lint roots", () => {
    const roots = getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir: ["components/{shell,tutorial}", "package.json"] } } });
    expect(roots.map(root => resolve(root)).sort()).toEqual([resolve("components/shell"), resolve("components/tutorial")].sort());
  });

  it("does not expand a literal Next lint root into descendants", () => {
    const roots = getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir: resolve("components") } } });
    expect(roots.map(root => resolve(root))).toEqual([resolve("components")]);
  });

  it("preserves Mammoth CLI help and Word conversion with argparse 2", () => {
    const cli = require.resolve("mammoth/bin/mammoth");
    const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    expect(run("--help")).toContain("--output-format");
    expect(run("lib/ingest/__fixtures__/beta-handbook.docx", "--output-format", "html")).toContain("Decision: Beta ships on iOS first, in March 2027.");
  });
});
