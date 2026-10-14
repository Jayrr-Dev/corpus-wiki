import type { ExtractedPage } from "./passages";

// =====================================================================
// TEXT EXTRACTION, one extractor per accepted file type. The prototype
// accepts PDF uploads only (Sam, 2026-10-14); plain text and Markdown are
// read too so the eval fixtures (.md) run through the same pipeline.
// =====================================================================

// ACCEPTED UPLOAD TYPES
export const PDF_MIME_TYPE = "application/pdf";
export const UPLOAD_MIME_TYPES = [PDF_MIME_TYPE] as const;

// Reads a PDF page by page (unpdf: pdf.js built for servers, no native deps)
export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((pageText, index) => ({ page: index + 1, text: pageText }));
}

// Text files have no pages: the whole text is one page
export function extractPlainText(text: string): ExtractedPage[] {
  return [{ page: null, text }];
}
