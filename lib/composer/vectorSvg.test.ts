import { expect, it } from "vitest";
import { validateVectorSvg } from "./vectorSvg";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M0 0L20 20" fill="red"/></svg>';
it("accepts provider-sized inert SVGs without imposing the diagram viewBox", () => expect(validateVectorSvg(svg)).toEqual([]));
it("preserves inert C2PA metadata and the provider's simple display style", () => {
  expect(validateVectorSvg(svg.replace('viewBox=', 'style="display: block;" xmlns:c2pa="http://c2pa.org/manifest" viewBox=').replace('</svg>', '<metadata><c2pa:manifest>YWJjZA==</c2pa:manifest></metadata></svg>'))).toEqual([]);
});
it.each(['<script>alert(1)</script>', '<foreignObject/>', '<image href="https://example.com/a.png"/>', '<path onclick="bad()"/>', '<path style="background:url(https://example.com)"/>', '<use href="https://example.com/a.svg"/>'])("blocks active/external vector content: %s", (content) => expect(validateVectorSvg(svg.replace('</svg>', `${content}</svg>`)).length).toBeGreaterThan(0));
