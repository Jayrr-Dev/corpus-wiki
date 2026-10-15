import { describe, expect, it } from "vitest";
import { parseDelimited, previewKindOf } from "./kind";

describe("previewKindOf", () => {
  it("uses a specific MIME type", () => {
    expect(previewKindOf("application/pdf", "x.bin")).toBe("pdf");
    expect(previewKindOf("image/png")).toBe("image");
    expect(previewKindOf("text/markdown; charset=utf-8")).toBe("markdown");
  });

  it("lets the extension refine text/plain and fill in a missing type", () => {
    expect(previewKindOf("text/plain", "notes.md")).toBe("markdown");
    expect(previewKindOf("text/plain", "notes.txt")).toBe("text");
    expect(previewKindOf("application/octet-stream", "clip.MP4")).toBe("video");
    expect(previewKindOf(null, "data.csv")).toBe("table");
    expect(previewKindOf(null, "archive.zip")).toBe("unknown");
  });
});

describe("parseDelimited", () => {
  it("splits rows and keeps quoted commas and quotes", () => {
    expect(parseDelimited('a,b\r\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("detects tabs", () => {
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
