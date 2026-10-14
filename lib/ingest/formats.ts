// =====================================================================
// UPLOAD FORMATS: every file type the one ingestion pipeline accepts.
// Each format has a converter (lib/ingest/convert.ts) that turns the file
// into located text; after that every format follows the same steps
// (passages -> Nemotron -> Change control -> living page).
// Pure data, safe to import in the browser (the Upload screen's accept list).
// =====================================================================

export type UploadFormatId = "pdf" | "docx" | "markdown" | "text";

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
];

// FORMATS WITH A SLOT BUT NO CONVERTER YET: images, audio and video need a
// model that reads them (vision / speech-to-text); each becomes one more
// entry above plus one converter, and the rest of the pipeline stays as is.
export const PLANNED_FORMATS = ["image", "audio", "video"] as const;

// For <input accept>: every extension and MIME type above
export const UPLOAD_ACCEPT = UPLOAD_FORMATS.flatMap((f) => [...f.extensions, ...f.mimeTypes]).join(",");

// The format of a file, by extension first (browsers often send no or a generic MIME type)
export function formatOf(fileName: string, mimeType: string): UploadFormat | null {
  const name = fileName.toLowerCase();
  return (
    UPLOAD_FORMATS.find((f) => f.extensions.some((ext) => name.endsWith(ext))) ??
    UPLOAD_FORMATS.find((f) => f.mimeTypes.includes(mimeType)) ??
    null
  );
}

// "PDF, Word, Markdown or Text": for messages on the Upload screen
export const UPLOAD_FORMAT_NAMES = UPLOAD_FORMATS.map((f) => f.label).join(", ").replace(/, ([^,]*)$/, " or $1");
