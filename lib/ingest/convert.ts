import type { ImageDescriber } from "./describeMedia";
import { type VideoReader, videoPages } from "./describeVideo";
import { readDocx } from "./docx";
import type { FileFormatId } from "./formats";
import { bookSectionPaths, type PdfOutlineSource } from "./pdfSections";
import type { ExtractedPage } from "./passages";

// =====================================================================
// CONVERTERS: one per upload format, each turning the file's bytes into
// located text (pages). The only format-specific step in the pipeline.
// =====================================================================

// What some converters need besides the bytes: the file's name and type, and for
// images and videos the models that read them, and for pictures inside a document a place to
// store them (the server passes them; tests pass fakes)
export type ConvertContext = {
  fileName: string; mimeType: string; describeImage?: ImageDescriber | null; readVideo?: VideoReader | null;
  storeFigure?: ((path: string, bytes: Uint8Array, mimeType: string) => Promise<string>) | null;
};

export type Converter = (bytes: Uint8Array, context?: ConvertContext) => Promise<ExtractedPage[]>;

// PDF: page by page (unpdf: pdf.js built for servers, no native deps).
// Bookmarks become each page's section path, shown beside the page number.
async function convertPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js may detach the buffer it reads, so it gets its own copy
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  const paths = await bookSectionPaths(pdf as PdfOutlineSource, text);
  return text.map((pageText, index) => {
    const sectionPath = paths[index];
    return { page: index + 1, text: pageText, ...(sectionPath ? { sectionPath } : {}) };
  });
}

// WORD (.docx): the document's paragraphs, with each embedded picture described in its place (docx.ts)
async function convertDocx(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  return readDocx(bytes, context && { fileName: context.fileName, describeImage: context.describeImage, storeFigure: context.storeFigure });
}

// TEXT AND MARKDOWN: no pages; Markdown headings become passage locations
async function convertText(bytes: Uint8Array): Promise<ExtractedPage[]> {
  return extractPlainText(new TextDecoder().decode(bytes));
}

// IMAGES: no text to extract, so a vision model writes a description, summary first; that
// description is the image's text from here on (passages, claims, citations)
async function convertImage(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  if (!context?.describeImage) throw new Error("Images are read by an AI model, and none is set up (NEBIUS_API_KEY is missing).");
  const description = await context.describeImage({ bytes, mimeType: context.mimeType, fileName: context.fileName });
  return [{ page: null, text: description }];
}

// VIDEO: the description of its frames, summary first, then the transcript, each piece at the
// time it starts ({ time: "mm:ss" } on its passages)
async function convertVideo(bytes: Uint8Array, context?: ConvertContext): Promise<ExtractedPage[]> {
  if (!context?.readVideo) throw new Error("Videos are read by an AI model, and none is set up (NEBIUS_API_KEY is missing).");
  return videoPages(await context.readVideo({ bytes, mimeType: context.mimeType, fileName: context.fileName }));
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
};
