// =====================================================================
// UPLOAD FORMATS: every file type the one ingestion pipeline accepts.
// Each format has a converter (lib/ingest/convert.ts) that turns the file
// into located text; after that every format follows the same steps
// (passages -> Nemotron -> Change control -> living page).
// Pure data, safe to import in the browser (the Upload screen's accept list).
// =====================================================================

import type { FeatureFlagKey } from "@/lib/flags/registry";

export type UploadFormatId = "pdf" | "docx" | "markdown" | "text" | "image" | "video" | "chat";

// FORMATS THAT BECOME ONE SOURCE: each has a converter in lib/ingest/convert.ts.
// A chat export becomes one source per conversation instead (lib/ingest/chatImport.ts).
export type FileFormatId = Exclude<UploadFormatId, "chat">;

export type UploadFormat = {
  id: UploadFormatId;
  label: string;
  mimeTypes: readonly string[];
  extensions: readonly string[]; // lowercase, with the dot
};

// FORMATS WITH A CONVERTER TODAY
export const UPLOAD_FORMATS: readonly UploadFormat[] = [
  { id: "pdf", label: "PDF", mimeTypes: ["application/pdf"], extensions: [".pdf"] },
  {
    id: "docx",
    label: "Word",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    extensions: [".docx"],
  },
  { id: "markdown", label: "Markdown", mimeTypes: ["text/markdown", "text/x-markdown"], extensions: [".md", ".markdown"] },
  { id: "text", label: "Text", mimeTypes: ["text/plain"], extensions: [".txt"] },
  // IMAGES: a vision model writes the description; the description is the text (lib/ingest/describeMedia.ts)
  {
    id: "image",
    label: "Image",
    mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  },
  // VIDEO: speech-to-text writes the transcript and the vision model describes sampled frames
  // (lib/ingest/describeVideoServer.ts). Too big for a Server Action body, so the browser
  // uploads it straight to Storage first (see DIRECT_UPLOAD_FORMATS).
  {
    id: "video",
    label: "Video",
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    extensions: [".mp4", ".webm", ".mov"],
  },
];

// CHAT EXPORT (behind the chat_import flag): a ChatGPT data export, its conversations.json
// or the export .zip holding it. The name only suggests it; the server checks the content
// (lib/ingest/chatExport.ts) and turns each conversation into its own source.
export const CHAT_EXPORT_FORMAT: UploadFormat = {
  id: "chat",
  label: "ChatGPT export",
  mimeTypes: ["application/json", "application/zip", "application/x-zip-compressed"],
  extensions: [".json", ".zip"],
};

// FORMATS BEHIND A FEATURE FLAG: listed only while their flag is on
export const FLAGGED_FORMATS: readonly { flag: FeatureFlagKey; format: UploadFormat }[] = [{ flag: "chat_import", format: CHAT_EXPORT_FORMAT }];

// The flags a caller knows (the browser's provider, the server's read); a missing flag is off
export type FormatFlags = Partial<Record<FeatureFlagKey, boolean>>;

// Every format readable with these flags: the ones above, plus each flagged one that is on
export function uploadFormats(flags: FormatFlags = {}): readonly UploadFormat[] {
  const flagged = FLAGGED_FORMATS.filter(({ flag }) => flags[flag] === true).map(({ format }) => format);
  return flagged.length ? [...UPLOAD_FORMATS, ...flagged] : UPLOAD_FORMATS;
}

// FORMATS WITH A SLOT BUT NO CONVERTER YET: audio is video's transcript without the
// frames; it becomes one more entry above plus one converter, and the rest of the
// pipeline stays as is.
export const PLANNED_FORMATS = ["audio"] as const;

// FORMATS THE BROWSER PUTS IN STORAGE ITSELF: a video is larger than the 20 MB Server
// Action body (next.config.ts), so it goes to a signed upload URL and the server reads it there
export const DIRECT_UPLOAD_FORMATS: readonly UploadFormatId[] = ["video"];
export const MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase Storage's default per-file limit

// For <input accept>: every extension and MIME type above (and the flagged ones that are on)
export function uploadAccept(flags: FormatFlags = {}): string {
  return uploadFormats(flags).flatMap((f) => [...f.extensions, ...f.mimeTypes]).join(",");
}
export const UPLOAD_ACCEPT = uploadAccept();

// The format of a file, by extension first (browsers often send no or a generic MIME type)
export function formatOf(fileName: string, mimeType: string, flags: FormatFlags = {}): UploadFormat | null {
  const name = fileName.toLowerCase();
  const formats = uploadFormats(flags);
  return (
    formats.find((f) => f.extensions.some((ext) => name.endsWith(ext))) ??
    formats.find((f) => f.mimeTypes.includes(mimeType)) ??
    null
  );
}

// The MIME type a source is stored with: the browser's when the format knows it, else
// the one its extension names (a .jpg sent with no type is image/jpeg), else the format's first
const MIME_BY_EXTENSION: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
export function storedMimeType(format: UploadFormat, fileName: string, browserType: string): string {
  if (format.mimeTypes.includes(browserType)) return browserType;
  const extension = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0] ?? "";
  return MIME_BY_EXTENSION[extension] ?? format.mimeTypes[0] ?? browserType;
}

// SOURCES THAT ARE PICTURES OR FILM: the article shows them as figures beside the lines citing them
export type MediaKind = "image" | "video";
export function mediaKindOf(mimeType: string | null | undefined): MediaKind | null {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return null;
}

// "PDF, Word, Markdown or Text": for messages on the Upload screen
export function uploadFormatNames(flags: FormatFlags = {}): string {
  return uploadFormats(flags).map((f) => f.label).join(", ").replace(/, ([^,]*)$/, " or $1");
}
export const UPLOAD_FORMAT_NAMES = uploadFormatNames();
