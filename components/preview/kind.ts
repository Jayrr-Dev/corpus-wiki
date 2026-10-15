// =====================================================================
// PREVIEW KINDS: how FilePreview draws a file, picked from its MIME type
// first and its extension second (stored files often carry a generic type).
// Pure, safe to import anywhere.
// =====================================================================

export type PreviewKind = "pdf" | "image" | "video" | "audio" | "markdown" | "text" | "code" | "json" | "table" | "html" | "docx" | "unknown";

const BY_EXTENSION: Record<string, PreviewKind> = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", svg: "image", bmp: "image", ico: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", m4a: "audio", aac: "audio", flac: "audio", opus: "audio",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  txt: "text", log: "text", rtf: "text",
  json: "json", jsonl: "json", geojson: "json",
  csv: "table", tsv: "table",
  html: "html", htm: "html",
  docx: "docx",
  js: "code", jsx: "code", ts: "code", tsx: "code", mjs: "code", cjs: "code", py: "code", rb: "code", go: "code", rs: "code",
  java: "code", kt: "code", swift: "code", c: "code", h: "code", cpp: "code", cs: "code", php: "code", sh: "code", ps1: "code",
  sql: "code", css: "code", scss: "code", yaml: "code", yml: "code", toml: "code", xml: "code", ini: "code", env: "code",
};

const BY_MIME: [RegExp, PreviewKind][] = [
  [/^application\/pdf$/, "pdf"],
  [/^image\//, "image"],
  [/^video\//, "video"],
  [/^audio\//, "audio"],
  [/^text\/(x-)?markdown$/, "markdown"],
  [/^(application|text)\/(json|ld\+json|x-ndjson|geo\+json)$/, "json"],
  [/^text\/(csv|tab-separated-values)$/, "table"],
  [/^text\/html$/, "html"],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, "docx"],
  [/^(text\/(javascript|css|x-[\w+-]+)|application\/(javascript|typescript|xml|x-sh|x-yaml|yaml|toml|sql))$/, "code"],
  [/^text\//, "text"],
];

// Lowercase extension without the dot ("report.PDF" -> "pdf"); "" when there is none
export function extensionOf(name: string | null | undefined): string {
  const match = /\.([a-z0-9]+)$/i.exec(name ?? "");
  return match?.[1]?.toLowerCase() ?? "";
}

// The kind for a MIME type and/or file name; a specific MIME type wins, then the extension
export function previewKindOf(mimeType: string | null | undefined, fileName?: string | null): PreviewKind {
  const mime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const byMime = BY_MIME.find(([pattern]) => pattern.test(mime))?.[1];
  const byExtension = BY_EXTENSION[extensionOf(fileName)];
  // text/plain is what browsers send for most source files: let the extension refine it
  if (byMime && !(byMime === "text" && byExtension)) return byMime;
  return byExtension ?? "unknown";
}

// Short label for the header ("PDF", "Image", "Markdown")
export const PREVIEW_KIND_LABEL: Record<PreviewKind, string> = {
  pdf: "PDF", image: "Image", video: "Video", audio: "Audio", markdown: "Markdown", text: "Text", code: "Code",
  json: "JSON", table: "Table", html: "HTML", docx: "Word", unknown: "File",
};

// Kinds drawn from the file's text (fetched, then rendered here) rather than by the browser
export const TEXT_KINDS: ReadonlySet<PreviewKind> = new Set(["markdown", "text", "code", "json", "table", "html"]);

// CSV / TSV ROWS: quote-aware split, enough for a preview (no type inference)
export function parseDelimited(text: string, delimiter = text.includes("\t") && !text.includes(",") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let isQuoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (isQuoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') isQuoted = false;
      else cell += char;
    } else if (char === '"') isQuoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
