import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanOcrMarkdown, MAX_OCR_BYTES, pagesNeedingOcr } from "./ocr";
import { MISTRAL_OCR_URL, textReaderFrom } from "./ocrServer";

describe("OCR", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finds the PDF pages with no real text layer", () => {
    expect(pagesNeedingOcr(["A full page of text, long enough to count.", "", "  \n 12 ", "Another page of real text here."])).toEqual([1, 2]);
  });

  it("drops picture placeholders from OCR Markdown", () => {
    expect(cleanOcrMarkdown("# Title\n\n![img-0.jpeg](img-0.jpeg)\n\n\n\nBody text.")).toBe("# Title\n\nBody text.");
  });

  it("is off without MISTRAL_API_KEY", () => {
    expect(textReaderFrom({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("sends a PDF's pages as a base64 document and returns their Markdown in page order", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ pages: [{ index: 3, markdown: "Page four." }, { index: 1, markdown: "Page two." }], usage_info: { pages_processed: 2 } })));
    vi.stubGlobal("fetch", fetchMock);
    const logged: unknown[] = [];
    const read = textReaderFrom({ MISTRAL_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv, async (call) => void logged.push(call))!;
    expect(await read({ bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: "scan.pdf", pages: [1, 3] })).toEqual(["Page two.", "Page four."]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MISTRAL_OCR_URL);
    expect(JSON.parse(init.body as string)).toEqual({ model: "mistral-ocr-latest", document: { type: "document_url", document_url: "data:application/pdf;base64,JVBERg==" }, pages: [1, 3], include_image_base64: false });
    expect(logged).toEqual([expect.objectContaining({ purpose: "ocr", subject: "scan.pdf (2 pages)", status: "ok" })]);
  });

  it("sends an image as an image URL, using AI_OCR_MODEL when set", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ pages: [{ index: 0, markdown: "EXIT" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const read = textReaderFrom({ MISTRAL_API_KEY: "test-key", AI_OCR_MODEL: "mistral-ocr-4-1" } as unknown as NodeJS.ProcessEnv)!;
    expect(await read({ bytes: new Uint8Array([1]), mimeType: "image/png", fileName: "sign.png" })).toEqual(["EXIT"]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "mistral-ocr-4-1", document: { type: "image_url", image_url: "data:image/png;base64,AQ==" } });
  });

  it("refuses a file too big to send, and reports a failed request", async () => {
    const read = textReaderFrom({ MISTRAL_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv)!;
    await expect(read({ bytes: new Uint8Array(MAX_OCR_BYTES + 1), mimeType: "application/pdf", fileName: "big.pdf" })).rejects.toThrow(/up to 50 MB/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })));
    await expect(read({ bytes: new Uint8Array([1]), mimeType: "application/pdf", fileName: "x.pdf" })).rejects.toThrow("Unauthorized");
  });
});
