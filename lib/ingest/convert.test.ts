import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONVERTERS } from "./convert";
import { formatOf, UPLOAD_ACCEPT } from "./formats";
import { splitIntoPassages } from "./passages";

// Reads a small sample file from __fixtures__
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "__fixtures__", name)));

describe("one pipeline, one converter per format", () => {
  it("knows each format by extension, even when the browser sends no MIME type", () => {
    expect(formatOf("Notes.DOCX", "")?.id).toBe("docx");
    expect(formatOf("readme.md", "text/plain")?.id).toBe("markdown");
    expect(formatOf("photo.png", "image/png")).toBeNull();
    expect(UPLOAD_ACCEPT).toContain(".pdf");
  });

  it("reads a PDF page by page into located passages", async () => {
    const passages = splitIntoPassages(await CONVERTERS.pdf(fixture("acme-onboarding.pdf")));
    expect(passages[0]?.location.page).toBe(1);
    expect(passages.map((p) => p.text).join(" ")).toContain("Python 3.13");
  });

  it("reads a Word document into passages", async () => {
    const passages = splitIntoPassages(await CONVERTERS.docx(fixture("beta-handbook.docx")));
    expect(passages.map((p) => p.text)).toContain("Decision: Beta ships on iOS first, in March 2027.");
  });

  it("reads Markdown with its headings as locations", async () => {
    const bytes = new TextEncoder().encode("# Plan\n\nShip in May.");
    const passages = splitIntoPassages(await CONVERTERS.markdown(bytes));
    expect(passages[1]).toMatchObject({ text: "Ship in May.", location: { heading: "Plan" } });
  });
});
