"use client";

import { type ChangeEvent, type DragEvent, type ReactNode, useRef, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/lib/flags/client";
import { type FormatFlags, formatOf, uploadAcceptFor, uploadFormatNamesFor } from "@/lib/ingest/formats";
import { cn } from "@/lib/utils";

type UploadDropzoneProps = { onFiles: (files: File[]) => void; children?: ReactNode };

// Splits picked files into ones a converter can read (with the flags on now) and the names of the rest
function splitByFormat(files: File[], flags: FormatFlags): { accepted: File[]; rejected: string[] } {
  const accepted = files.filter((file) => formatOf(file.name, file.type, flags));
  const rejected = files.filter((file) => !formatOf(file.name, file.type, flags)).map((file) => file.name);
  return { accepted, rejected };
}

// Message for files no converter can read
function rejectionMessage(names: string[], formatNames: string): string | null {
  if (names.length === 0) return null;
  return `This file type can't be read yet. Upload ${formatNames}. (${names.join(", ")})`;
}

// UPLOAD DROPZONE: drop files or pick them from the computer; unreadable types are refused with a message.
// `children` are further actions shown beside Choose files (Add link)
export function UploadDropzone({ onFiles, children }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const flags = useFeatureFlags();
  const formatNames = uploadFormatNamesFor(flags);
  const take = (files: File[]) => {
    const split = splitByFormat(files, flags);
    setRejected(split.rejected);
    if (split.accepted.length > 0) onFiles(split.accepted);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsOver(false);
    take(Array.from(event.dataTransfer.files));
  };
  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    take(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={onDrop}
        data-tour="upload-dropzone"
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          isOver ? "border-foreground/40 bg-hover" : "hover:border-foreground/25",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <UploadIcon className="text-muted-foreground" size={18} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{isOver ? "Release to add these files" : "Drop files here to upload"}</p>
          <p className="text-xs text-muted-foreground">{formatNames}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          {children}
        </div>
        <input ref={inputRef} type="file" accept={uploadAcceptFor(flags)} multiple hidden onChange={onPick} />
      </div>
      <ErrorNote error={rejectionMessage(rejected, formatNames)} />
    </div>
  );
}
