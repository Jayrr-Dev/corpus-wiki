// =====================================================================
// UPLOAD FORMATS (placeholder from agent E so the worktree compiles; the
// lead's version of this file wins on merge). Pure and browser-safe.
// =====================================================================

export type UploadFormatId = "pdf" | "docx" | "markdown" | "text";

export type UploadFormat = { id: UploadFormatId; label: string; mimeTypes: readonly string[]; extensions: readonly string[] };

// FORMATS WITH A CONVERTER
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
];

// SLOTS FOR LATER (no converter yet)
export const PLANNED_FORMATS = ["image", "audio", "video"] as const;

// For <input accept>
export const UPLOAD_ACCEPT: string = UPLOAD_FORMATS.flatMap((format) => [...format.extensions, ...format.mimeTypes]).join(",");

// The format of a file by extension first, then mime type; null when none can read it
export function formatOf(fileName: string, mimeType: string): UploadFormat | null {
  const name = fileName.toLowerCase();
  const byExtension = UPLOAD_FORMATS.find((format) => format.extensions.some((extension) => name.endsWith(extension)));
  return byExtension ?? UPLOAD_FORMATS.find((format) => format.mimeTypes.includes(mimeType)) ?? null;
}

// "PDF, Word, Markdown or Text"
export const UPLOAD_FORMAT_NAMES: string = UPLOAD_FORMATS.map((format) => format.label)
  .join(", ")
  .replace(/, ([^,]*)$/, " or $1");
