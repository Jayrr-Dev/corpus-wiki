import type { ImageDescriber } from "./describeMedia";
import { type VideoReader, videoPages } from "./describeVideo";
import type { UploadFormatId } from "./formats";
import type { ExtractedPage } from "./passages";

// =====================================================================
// CONVERTERS: one per upload format, each turning the file's bytes into
// located text (pages). The only format-specific step in the pipeline.
// =====================================================================

// What some converters need besides the bytes: the file's name and type, and for
// images and videos the models that read them (the server passes them; tests pass fakes)
export type ConvertContext = { fileName: string; mimeType: string; describeImage?: ImageDescriber | null; readVideo?: VideoReader | null };

export type Converter = (bytes: Uint8Array, context?: ConvertContext) => Promise<ExtractedPage[]>;

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

// THE REGISTRY: a new format is one entry here plus one in formats.ts
export const CONVERTERS: Record<UploadFormatId, Converter> = {
  pdf: convertPdf,
  docx: convertDocx,
  markdown: convertText,
  text: convertText,
  image: convertImage,
  video: convertVideo,
};
