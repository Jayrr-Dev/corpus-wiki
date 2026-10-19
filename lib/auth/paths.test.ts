import { expect, it } from "vitest";
import { safeNextPath } from "./paths";

it("preserves local destinations and rejects redirects to another origin", () => {
  expect(safeNextPath("/settings?tab=security")).toBe("/settings?tab=security");
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/\n/example.com", null, 7]) expect(safeNextPath(path)).toBe("/");
});
