// =====================================================================
// OCR: the text printed on a page image, read by Mistral OCR. A scanned
// PDF has no text layer, so its empty pages are read this way; an image
// keeps its exact words beside the vision model's description of it.
// The reader is wired in by the server (ocrServer.ts); tests pass fakes.
// =====================================================================

// LARGEST FILE SENT (it travels inline as base64, a third bigger again)
export const MAX_OCR_BYTES = 50 * 1024 * 1024;

// A PDF page with fewer letters than this has no real text layer (a scan, or a picture of text)
export const SCANNED_PAGE_CHARS = 20;

// WHAT A CONVERTER SENDS: the file, and for a PDF the pages to read (0-based; all when left out)
export type TextToRead = { bytes: Uint8Array; mimeType: string; fileName: string; pages?: readonly number[] };
// The Markdown of each page read, in page order
export type TextReader = (file: TextToRead) => Promise<string[]>;

// The PDF pages (0-based) whose extracted text is too short to be a real text layer
export function pagesNeedingOcr(pageTexts: readonly string[]): number[] {
  return pageTexts.flatMap((text, index) => (text.replace(/\s/g, "").length < SCANNED_PAGE_CHARS ? [index] : []));
}

// OCR Markdown -> passage text: picture placeholders ("![img-0.jpeg](img-0.jpeg)") point at
// images the request did not ask for, so they are dropped
export function cleanOcrMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Refuses a file too big to send, before any model is called
export function requireReadableFile(file: TextToRead): void {
  if (file.bytes.byteLength > MAX_OCR_BYTES) {
    throw new Error(`This file is ${Math.ceil(file.bytes.byteLength / 1024 / 1024)} MB; files up to ${MAX_OCR_BYTES / 1024 / 1024} MB can be read with OCR.`);
  }
}
