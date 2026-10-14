import type { UploadFormatId } from "./formats";
import type { ExtractedPage } from "./passages";

// =====================================================================
// CONVERTERS: one per upload format, each turning the file's bytes into
// located text (pages). The only format-specific step in the pipeline.
// =====================================================================

export type Converter = (bytes: Uint8Array) => Promise<ExtractedPage[]>;

// PDF: page by page (unpdf: pdf.js built for servers, no native deps)
async function convertPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js may detach the buffer it reads, so it gets its own copy
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((pageText, index) => ({ page: index + 1, text: pageText }));
}

// WORD (.docx): the document's text, one paragraph per line break pair (mammoth)
async function convertDocx(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { default: mammoth } = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return [{ page: null, text: value }];
}

// TEXT AND MARKDOWN: no pages; Markdown headings become passage locations
async function convertText(bytes: Uint8Array): Promise<ExtractedPage[]> {
  return extractPlainText(new TextDecoder().decode(bytes));
}

// Text already in memory (the eval fixtures) as one page
export function extractPlainText(text: string): ExtractedPage[] {
  return [{ page: null, text }];
}

// THE REGISTRY: a new format is one entry here plus one in formats.ts
export const CONVERTERS: Record<UploadFormatId, Converter> = {
  pdf: convertPdf,
  docx: convertDocx,
  markdown: convertText,
  text: convertText,
};
