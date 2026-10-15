"use client";

import {
  DownloadIcon,
  ExternalLinkIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  type LucideIcon,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/standard/tooltip";
import { PREVIEW_KIND_LABEL, type PreviewKind, parseDelimited, previewKindOf, TEXT_KINDS } from "./kind";
import { Loader } from "@/components/standard/loader";

// =====================================================================
// FILE PREVIEW: one frame for any file the app stores. It picks a
// renderer from the MIME type / file name, so callers pass a URL and
// never branch on the type:
//   pdf               the browser's viewer (page, fit, toolbar via the URL fragment)
//   image/video/audio native elements
//   markdown/text/code/json/table  fetched and drawn here (large files are cut)
//   html/docx         rendered into a sandboxed iframe (no scripts)
//   unknown           a quiet note with Open and Download
// =====================================================================

export type PdfFit = "page" | "width" | "height" | "none";

export type FilePreviewProps = {
  // Inline URL for the file (same-origin route or signed URL)
  src: string;
  title: string;
  mimeType?: string | null;
  // Used for the extension when the MIME type is generic; defaults to `title`
  fileName?: string;
  // Overrides the detected kind
  kind?: PreviewKind;
  // Where Download points; defaults to `src`
  downloadHref?: string;
  // Header with the title, kind and Open/Download buttons
  header?: boolean;
  // false hides scrollbars (and the PDF viewer's own)
  scrollbar?: boolean;
  // PDF only: first page shown (1-based), fit, and the viewer's toolbar
  page?: number;
  fit?: PdfFit;
  viewerToolbar?: boolean;
  // PDF only: the viewer's thumbnail / outline sidebar (off: it crowds narrow frames)
  navPanes?: boolean;
  // Height of the body; any CSS length (default 32rem)
  height?: CSSProperties["height"];
  // Text kinds are cut after this many characters
  maxTextChars?: number;
  className?: string;
};

const KIND_ICON: Record<PreviewKind, LucideIcon> = {
  pdf: FileTextIcon, image: FileImageIcon, video: FileVideoIcon, audio: FileAudioIcon, markdown: FileTextIcon, text: FileTextIcon,
  code: FileCodeIcon, json: FileCodeIcon, table: FileSpreadsheetIcon, html: FileCodeIcon, docx: FileTextIcon, unknown: FileIcon,
};

const PDF_FIT_VIEW: Record<PdfFit, string | null> = { page: "Fit", width: "FitH", height: "FitV", none: null };
const TABLE_ROW_LIMIT = 500;

export function FilePreview({
  src,
  title,
  mimeType,
  fileName,
  kind: kindOverride,
  downloadHref,
  header = true,
  scrollbar = true,
  page,
  fit = "width",
  viewerToolbar = true,
  navPanes = false,
  height = "32rem",
  maxTextChars = 400_000,
  className,
}: FilePreviewProps) {
  const kind = kindOverride ?? previewKindOf(mimeType, fileName ?? title);
  const body = { src, title, kind, scrollbar, maxTextChars, pdf: { page, fit, viewerToolbar, navPanes } };
  // Height goes through a custom property; audio is one control row, so it keeps its natural height
  const style = { "--preview-height": typeof height === "number" ? `${height}px` : height } as CSSProperties;
  return (
    <figure className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card", className)}>
      {header ? <PreviewHeader title={title} kind={kind} src={src} downloadHref={downloadHref ?? src} /> : null}
      <div
        className={cn("relative min-h-0 bg-muted/40", kind !== "audio" && "h-(--preview-height)", scrollbar ? "overflow-auto" : "overflow-hidden no-scrollbar")}
        style={style}
      >
        <PreviewBody {...body} downloadHref={downloadHref ?? src} />
      </div>
    </figure>
  );
}

// HEADER: kind icon, title and kind, then Open in a new tab and Download
function PreviewHeader({ title, kind, src, downloadHref }: { title: string; kind: PreviewKind; src: string; downloadHref: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <figcaption className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-medium">{title}</span>
      <span className="shrink-0 text-xs text-faint">{PREVIEW_KIND_LABEL[kind]}</span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <HeaderLink href={src} label="Open in a new tab" isNewTab><ExternalLinkIcon className="size-4" /></HeaderLink>
        <HeaderLink href={downloadHref} label="Download" isDownload><DownloadIcon className="size-4" /></HeaderLink>
      </span>
    </figcaption>
  );
}

function HeaderLink({ href, label, isNewTab, isDownload, children }: { href: string; label: string; isNewTab?: boolean; isDownload?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <a
        href={href}
        aria-label={label}
        target={isNewTab ? "_blank" : undefined}
        rel={isNewTab ? "noreferrer" : undefined}
        download={isDownload ? "" : undefined}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        {children}
      </a>
    </Tooltip>
  );
}

type BodyProps = {
  src: string;
  title: string;
  kind: PreviewKind;
  scrollbar: boolean;
  maxTextChars: number;
  downloadHref: string;
  pdf: { page?: number; fit: PdfFit; viewerToolbar: boolean; navPanes: boolean };
};

// BODY: one renderer per kind
function PreviewBody({ src, title, kind, scrollbar, maxTextChars, downloadHref, pdf }: BodyProps) {
  switch (kind) {
    case "pdf":
      return <iframe title={title} src={pdfUrl(src, { ...pdf, scrollbar })} className="size-full border-0 bg-white" />;
    case "image":
      return (
        <div className="flex min-h-full items-center justify-center p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs; next/image cannot cache them */}
          <img src={src} alt={title} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case "video":
      return <video src={src} controls preload="metadata" className="size-full bg-black object-contain" />;
    case "audio":
      return (
        <div className="p-3">
          <audio src={src} controls preload="metadata" className="w-full" />
        </div>
      );
    case "docx":
      return <DocxBody src={src} title={title} />;
    case "unknown":
      return <PreviewNote>No inline preview for this file type. <a className="text-link underline-offset-2 hover:underline" href={downloadHref} download="">Download it</a> to open it.</PreviewNote>;
    default:
      return TEXT_KINDS.has(kind) ? <TextBody src={src} title={title} kind={kind} maxChars={maxTextChars} /> : null;
  }
}

// PDF URL: the open-parameters fragment Chrome, Edge and Firefox read (page, view, toolbar, scrollbar)
function pdfUrl(src: string, { page, fit, viewerToolbar, navPanes, scrollbar }: BodyProps["pdf"] & { scrollbar: boolean }): string {
  const params: string[] = [];
  if (page && page > 1) params.push(`page=${page}`);
  const view = PDF_FIT_VIEW[fit];
  if (view) params.push(`view=${view}`);
  if (!viewerToolbar) params.push("toolbar=0");
  if (!navPanes) params.push("navpanes=0");
  if (!scrollbar) params.push("scrollbar=0");
  return params.length > 0 ? `${src.split("#")[0]}#${params.join("&")}` : src;
}

// FETCHED FILE: loading / error / data for a URL read once per src
type Fetched<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

function useFetched<T>(src: string, read: (response: Response) => Promise<T>): Fetched<T> {
  const [state, setState] = useState<{ src: string; result: Fetched<T> }>({ src, result: { status: "loading" } });
  useEffect(() => {
    let isCurrent = true;
    fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
        return read(response);
      })
      .then((data) => isCurrent && setState({ src, result: { status: "ready", data } }))
      .catch((error: unknown) => isCurrent && setState({ src, result: { status: "error", message: error instanceof Error ? error.message : String(error) } }));
    return () => {
      isCurrent = false;
    };
    // `read` is a per-kind reader; refetch only when the file changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return state.src === src ? state.result : { status: "loading" };
}

function FetchedState<T>({ fetched, children }: { fetched: Fetched<T>; children: (data: T) => ReactNode }) {
  if (fetched.status === "loading") return <Loader label="Loading preview…" />;
  if (fetched.status === "error") return <PreviewNote>Could not load the preview ({fetched.message}).</PreviewNote>;
  return <>{children(fetched.data)}</>;
}

// TEXT KINDS: plain text, Markdown and code as text; JSON pretty-printed; CSV as a table; HTML sandboxed
function TextBody({ src, title, kind, maxChars }: { src: string; title: string; kind: PreviewKind; maxChars: number }) {
  const fetched = useFetched(src, (response) => response.text());
  return (
    <FetchedState fetched={fetched}>
      {(text) => {
        const isCut = text.length > maxChars;
        const shown = isCut ? text.slice(0, maxChars) : text;
        return (
          <>
            {kind === "table" ? <DelimitedTable text={shown} /> : null}
            {kind === "html" ? <SandboxedHtml title={title} html={shown} /> : null}
            {kind === "json" ? <TextBlock text={prettyJson(shown)} isMono /> : null}
            {kind === "code" ? <TextBlock text={shown} isMono /> : null}
            {kind === "markdown" || kind === "text" ? <TextBlock text={shown} /> : null}
            {isCut ? <PreviewNote>Preview cut at {maxChars.toLocaleString()} characters. Download the file for the rest.</PreviewNote> : null}
          </>
        );
      }}
    </FetchedState>
  );
}

function TextBlock({ text, isMono }: { text: string; isMono?: boolean }) {
  return <pre className={cn("min-h-full p-4 text-panel whitespace-pre-wrap break-words", isMono ? "font-mono text-xs" : "font-sans")}>{text}</pre>;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text; // JSON Lines, or cut mid-value: show as is
  }
}

// CSV / TSV: the first row as the header, capped for the DOM
function DelimitedTable({ text }: { text: string }) {
  const rows = useMemo(() => parseDelimited(text), [text]);
  const [head = [], ...body] = rows;
  const shown = body.slice(0, TABLE_ROW_LIMIT);
  return (
    <>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-card">
          <tr>{head.map((cell, i) => <th key={i} className="border-b px-2 py-1.5 text-left font-medium whitespace-nowrap">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r} className="border-b last:border-0">
              {row.map((cell, c) => <td key={c} className="px-2 py-1 align-top">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > shown.length ? <PreviewNote>Showing {shown.length.toLocaleString()} of {body.length.toLocaleString()} rows.</PreviewNote> : null}
    </>
  );
}

// WORD: converted to HTML in the browser (mammoth, loaded only when a .docx is shown)
function DocxBody({ src, title }: { src: string; title: string }) {
  const fetched = useFetched(src, async (response) => {
    const [buffer, mammoth] = await Promise.all([response.arrayBuffer(), import("mammoth")]);
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    return result.value;
  });
  return <FetchedState fetched={fetched}>{(html) => <SandboxedHtml title={title} html={html} />}</FetchedState>;
}

// SANDBOXED HTML: no scripts, forms or same-origin access; a light page like a printed document
const DOCUMENT_STYLE = `<style>
  body { margin: 0; padding: 24px 32px; font: 14px/1.55 system-ui, sans-serif; color: #1a1a1a; background: #fff; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: 4px 8px; }
</style>`;

function SandboxedHtml({ title, html }: { title: string; html: string }) {
  return <iframe title={title} sandbox="" srcDoc={`<!doctype html><meta charset="utf-8">${DOCUMENT_STYLE}${html}`} className="size-full border-0 bg-white" />;
}

function PreviewNote({ children }: { children: ReactNode }) {
  return <p className="p-4 text-panel text-faint">{children}</p>;
}
