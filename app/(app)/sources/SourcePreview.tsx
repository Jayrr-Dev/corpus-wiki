"use client";

import { FilePreview, type FilePreviewProps } from "@/components/preview";
import type { Tables } from "@/lib/database/types";

type Source = Pick<Tables<"sources">, "id" | "title" | "mime_type" | "storage_path">;

// The route that redirects to a source's stored file (?download=1 for an attachment)
export function sourceFileHref(sourceId: string, isDownload = false): string {
  return `/api/sources/${sourceId}/file${isDownload ? "?download=1" : ""}`;
}

// SOURCE PREVIEW: the original file, drawn by its type (Source detail, the "…" menu's Preview)
export function SourcePreview({ source, ...props }: { source: Source } & Omit<FilePreviewProps, "src" | "title" | "mimeType" | "downloadHref">) {
  return (
    <FilePreview
      src={sourceFileHref(source.id)}
      downloadHref={sourceFileHref(source.id, true)}
      title={source.title}
      mimeType={source.mime_type}
      fileName={source.storage_path || source.title}
      {...props}
    />
  );
}
