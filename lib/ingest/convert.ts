import type { ImageDescriber } from "./describeMedia";
import { type AudioReader, audioPages, type VideoReader, videoPages } from "./describeVideo";
import { readDocx } from "./docx";
import type { FileFormatId } from "./formats";
import { pagesNeedingOcr, type TextReader } from "./ocr";
import { bookSectionPaths, type PdfOutlineSource } from "./pdfSections";
import type { ExtractedPage } from "./passages";

// =====================================================================
// CONVERTERS: one per upload format, each turning the file's bytes into
// located text (pages). The only format-specific step in the pipeline.
// =====================================================================

// What some converters need besides the bytes: the file's name and type, and for
// images, videos and recordings the models that read them, for scans and images the OCR reader,
// and for pictures inside a document a place to store them (the server passes them; tests pass fakes)
export type ConvertContext = {
  fileName: string; mimeType: string; describeImage?: ImageDescriber | null; readVideo?: VideoReader | null; readAudio?: AudioReader | null;
  readText?: TextReader | null;
  storeFigure?: ((path: string, bytes: Uint8Array, mimeType: string) => Promise<string>) | null;
};

export type Converter = (bytes: Uint8Array, context?: ConvertContext) => Promise<ExtractedPage[]>;

// PDF: page by page (unpdf: pdf.js built for servers, no native deps).
// Bookmarks become each page's section path, shown beside the page number.
// Pages with no text layer (scans) are read with OCR when a reader is set up.
async function convertPdf(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js may detach the buffer it reads, so it gets its own copy
  const pdf = await getDocumentProxy(bytes.slice());
  const { text: extracted } = await extractText(pdf, { mergePages: false });
  const text = await withOcrPages(bytes, extracted, context);
  const paths = await bookSectionPaths(pdf as PdfOutlineSource, text);
  return text.map((pageText, index) => {
    const sectionPath = paths[index];
    return { page: index + 1, text: pageText, ...(sectionPath ? { sectionPath } : {}) };
  });
}

// The PDF's page texts with each empty page read by OCR. A whole scan with no reader, or whose
// reading fails, is refused; a few empty pages in a text PDF stay empty when OCR fails.
async function withOcrPages(bytes: Uint8Array, pageTexts: string[], context?: ConvertContext): Promise<string[]> {
  const missing = pagesNeedingOcr(pageTexts);
  if (missing.length === 0) return pageTexts;
  const wholeScan = missing.length === pageTexts.length;
  if (!context?.readText) {
    if (wholeScan) throw new Error("This PDF has no text layer (is it a scan?). Scans are read with OCR, and none is set up (MISTRAL_API_KEY is missing).");
    return pageTexts;
  }
  try {
    const read = await context.readText({ bytes, mimeType: "application/pdf", fileName: context.fileName, pages: missing });
    const merged = [...pageTexts];
    missing.forEach((pageIndex, position) => { merged[pageIndex] = read[position] ?? merged[pageIndex]!; });
    return merged;
  } catch (error) {
    if (wholeScan) throw error;
    console.error(`OCR of ${missing.length} empty pages in ${context.fileName} failed:`, error);
    return pageTexts;
  }
}

// WORD (.docx): the document's paragraphs, with each embedded picture described in its place (docx.ts)
async function convertDocx(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  return readDocx(bytes, context && { fileName: context.fileName, describeImage: context.describeImage, storeFigure: context.storeFigure });
}

// TEXT AND MARKDOWN: no pages; Markdown headings become passage locations
async function convertText(bytes: Uint8Array): Promise<ExtractedPage[]> {
  return extractPlainText(new TextDecoder().decode(bytes));
}

// IMAGES: no text to extract, so a vision model writes a description, summary first, and OCR
// adds the exact words printed in it after that; together they are the image's text from here
// on (passages, claims, citations). OCR is extra: when it fails the description stands alone.
async function convertImage(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  if (!context?.describeImage && !context?.readText) throw new Error("Images are read by an AI model, and none is set up (NEBIUS_API_KEY is missing).");
  const image = { bytes, mimeType: context.mimeType, fileName: context.fileName };
  const [description, printed] = await Promise.all([
    context.describeImage ? context.describeImage(image) : null,
    context.readText ? context.readText(image).then((pages) => pages.join("\n\n"), (error) => {
      if (!context.describeImage) throw error;
      console.error(`OCR of ${context.fileName} failed:`, error);
      return null;
    }) : null,
  ]);
  return [description, printed].flatMap((text) => (text?.trim() ? [{ page: null, text }] : []));
}

// VIDEO: the description of its frames, summary first, then the transcript, each piece at the
// time it starts ({ time: "mm:ss" } on its passages)
async function convertVideo(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  if (!context?.readVideo) throw new Error("Videos are read by an AI model, and none is set up (NEBIUS_API_KEY is missing).");
  return videoPages(await context.readVideo({ bytes, mimeType: context.mimeType, fileName: context.fileName }));
}

// AUDIO: the transcript speech-to-text writes, each paragraph at the time it starts
// ({ time: "mm:ss" } on its passages); a silent recording gives no pages
async function convertAudio(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  if (!context?.readAudio) throw new Error("Recordings are read by a speech-to-text model, and none is set up.");
  return audioPages(await context.readAudio({ bytes, mimeType: context.mimeType, fileName: context.fileName }));
}

// Text already in memory (the eval fixtures) as one page
export function extractPlainText(text: string): ExtractedPage[] {
  return [{ page: null, text }];
}

// THE REGISTRY: a new format is one entry here plus one in formats.ts (a chat export has none:
// it becomes many sources, see chatImport.ts)
export const CONVERTERS: Record<FileFormatId, Converter> = {
  pdf: convertPdf,
  docx: convertDocx,
  markdown: convertText,
  text: convertText,
  image: convertImage,
  video: convertVideo,
  audio: convertAudio,
};
