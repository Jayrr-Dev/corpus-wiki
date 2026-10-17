import { describe, it, expect } from "vitest";
import { validateSvg } from "./svg";
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">${body}</svg>`;
describe("Composer SVG boundary", () => {
  it("accepts an inert illustration with local paint", () => {
    expect(validateSvg(wrap('<defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient></defs><circle cx="200" cy="200" r="80" fill="url(#a)"/><text x="20" y="40" font-size="24">Apple</text>'))).toEqual([]);
  });
  it.each(['<script>alert(1)</script>', '<foreignObject/>', '<image href="https://evil.test/x"/>', '<rect onload="alert(1)"/>', '<rect fill="url(https://evil.test/x)"/>', '<style>body{}</style>', '<a href="javascript:alert(1)">x</a>'])("rejects executable or external SVG: %s", (body) => {
    expect(validateSvg(wrap(body)).length).toBeGreaterThan(0);
  });
  it("rejects declarations and small labels", () => {
    expect(validateSvg('<!DOCTYPE svg>' + wrap(""))).not.toEqual([]);
    expect(validateSvg(wrap('<text font-size="12">Tiny</text>'))).not.toEqual([]);
  });
});
