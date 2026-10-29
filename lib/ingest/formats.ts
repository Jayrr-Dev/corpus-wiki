// =====================================================================
// UPLOAD FORMATS: every file type the one ingestion pipeline accepts.
// Each format has a converter (lib/ingest/convert.ts) that turns the file
// into located text; after that every format follows the same steps
// (passages -> Nemotron -> Change control -> living page).
// Pure data, safe to import in the browser (the Upload screen's accept list).
// A format behind a feature flag (FORMAT_FLAGS) is left out of every list
// unless the caller passes flags with it on.
// =====================================================================

import type { FeatureFlagKey, FeatureFlags } from "@/lib/flags/registry";

export type UploadFormatId = "pdf" | "docx" | "markdown" | "text" | "image" | "video" | "audio" | "chat";

// FORMATS THAT BECOME ONE SOURCE: each has a converter in lib/ingest/convert.ts.
// A chat export becomes one source per conversation instead (lib/ingest/chatImport.ts).
export type FileFormatId = Exclude<UploadFormatId, "chat">;

// The flags the format lists read (any subset of the app's flags; a missing one is off)
export type FormatFlags = Partial<FeatureFlags>;

export type UploadFormat = {
  id: UploadFormatId;
  label: string;
  mimeTypes: readonly string[];
  extensions: readonly string[]; // lowercase, with the dot
};

// CHAT EXPORT: a ChatGPT data export, its conversations.json or the export .zip holding it.
// The name only suggests it; the server checks the content (lib/ingest/chatExport.ts) and
// turns each conversation into its own source.
export const CHAT_EXPORT_FORMAT: UploadFormat = {
  id: "chat",
  label: "ChatGPT export",
  mimeTypes: ["application/json", "application/zip", "application/x-zip-compressed"],
  extensions: [".json", ".zip"],
};

// FORMATS WITH A CONVERTER, flagged ones included (see FORMAT_FLAGS)
export const ALL_UPLOAD_FORMATS: readonly UploadFormat[] = [
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
  // AUDIO: video's transcript without the frames (the same speech-to-text step, no vision
  // model). A .webm is video unless the browser calls it audio/webm; .weba is always audio.
  {
    id: "audio",
    label: "Audio",
    mimeTypes: ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/webm"],
    extensions: [".mp3", ".m4a", ".wav", ".ogg", ".oga", ".weba", ".webm"],
  },
  CHAT_EXPORT_FORMAT,
];

// FORMATS BEHIND A FEATURE FLAG: while the flag is off the format is in no list, so it is refused everywhere
export const FORMAT_FLAGS: Partial<Record<UploadFormatId, FeatureFlagKey>> = { audio: "audio_ingest", chat: "chat_import" };

// The formats these flags allow (no flags: only the unflagged ones)
export function uploadFormatsFor(flags: FormatFlags = {}): readonly UploadFormat[] {
  return ALL_UPLOAD_FORMATS.filter((format) => {
    const flag = FORMAT_FLAGS[format.id];
    return !flag || flags[flag] === true;
  });
}

// FORMATS WITH A CONVERTER AND NO FLAG
export const UPLOAD_FORMATS: readonly UploadFormat[] = uploadFormatsFor();

// FORMATS WITH A SLOT BUT NO CONVERTER YET (none at the moment)
export const PLANNED_FORMATS: readonly string[] = [];

// FORMATS THE BROWSER PUTS IN STORAGE ITSELF: a video or a recording is larger than the 20 MB
// Server Action body (next.config.ts), so it goes to a signed upload URL and the server reads it there
export const DIRECT_UPLOAD_FORMATS: readonly UploadFormatId[] = ["video", "audio"];
export const MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase Storage's default per-file limit

// For <input accept>: every extension and MIME type the flags allow
export function uploadAcceptFor(flags: FormatFlags = {}): string {
  return uploadFormatsFor(flags).flatMap((f) => [...f.extensions, ...f.mimeTypes]).join(",");
}
export const UPLOAD_ACCEPT = uploadAcceptFor();

// The format of a file, by extension first (browsers often send no or a generic MIME type).
// An extension two formats share (.webm) goes to the one whose MIME types include the browser's.
export function formatOf(fileName: string, mimeType: string, flags: FormatFlags = {}): UploadFormat | null {
  const name = fileName.toLowerCase();
  const formats = uploadFormatsFor(flags);
  const byExtension = formats.filter((f) => f.extensions.some((ext) => name.endsWith(ext)));
  return (
    byExtension.find((f) => f.mimeTypes.includes(mimeType)) ??
    byExtension[0] ??
    formats.find((f) => f.mimeTypes.includes(mimeType)) ??
    null
  );
}

// The MIME type a source is stored with: the browser's when the format knows it, else the one
// its extension names for that format (a .jpg sent with no type is image/jpeg), else the format's first
const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"], ".png": ["image/png"], ".webp": ["image/webp"], ".gif": ["image/gif"],
  ".mp4": ["video/mp4"], ".webm": ["video/webm", "audio/webm"], ".mov": ["video/quicktime"],
  ".mp3": ["audio/mpeg"], ".m4a": ["audio/mp4"], ".wav": ["audio/wav"], ".ogg": ["audio/ogg"], ".oga": ["audio/ogg"], ".weba": ["audio/webm"],
};
export function storedMimeType(format: UploadFormat, fileName: string, browserType: string): string {
  if (format.mimeTypes.includes(browserType)) return browserType;
  const extension = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0] ?? "";
  return MIME_BY_EXTENSION[extension]?.find((mime) => format.mimeTypes.includes(mime)) ?? format.mimeTypes[0] ?? browserType;
}

// SOURCES THAT ARE PICTURES OR FILM: the article shows them as figures beside the lines citing them
// (a recording has no picture, so it is not one)
export type MediaKind = "image" | "video";
export function mediaKindOf(mimeType: string | null | undefined): MediaKind | null {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return null;
}

// "PDF, Word, Markdown or Text": for messages on the Upload screen
export function uploadFormatNamesFor(flags: FormatFlags = {}): string {
  return uploadFormatsFor(flags).map((f) => f.label).join(", ").replace(/, ([^,]*)$/, " or $1");
}
export const UPLOAD_FORMAT_NAMES = uploadFormatNamesFor();
