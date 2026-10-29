import { expect, it } from "vitest";
import { APP_HOME, safeNextPath } from "./paths";

it("preserves local destinations and rejects redirects to another origin", () => {
  expect(safeNextPath("/settings?tab=security")).toBe("/settings?tab=security");
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/\n/example.com", null, 7]) expect(safeNextPath(path)).toBe(APP_HOME);
});

it("sends a sign-in aimed at the landing page to the app instead", () => {
  expect(safeNextPath("/")).toBe(APP_HOME);
});
