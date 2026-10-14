"use client";

import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { formatOf, UPLOAD_ACCEPT, UPLOAD_FORMAT_NAMES } from "@/lib/ingest/formats";
import { cn } from "@/lib/utils";

type UploadDropzoneProps = { onFiles: (files: File[]) => void };

// Splits picked files into ones a converter can read and the names of the rest
function splitByFormat(files: File[]): { accepted: File[]; rejected: string[] } {
  const accepted = files.filter((file) => formatOf(file.name, file.type));
  const rejected = files.filter((file) => !formatOf(file.name, file.type)).map((file) => file.name);
  return { accepted, rejected };
}

// Message for files no converter can read
function rejectionMessage(names: string[]): string | null {
  if (names.length === 0) return null;
  return `This file type can't be read yet. Upload ${UPLOAD_FORMAT_NAMES}. (${names.join(", ")})`;
}

// UPLOAD DROPZONE: drop files or pick them from the computer; unreadable types are refused with a message
export function UploadDropzone({ onFiles }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const take = (files: File[]) => {
    const split = splitByFormat(files);
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
        className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center", isOver && "bg-hover")}
      >
        <UploadIcon className="text-faint" size={20} />
        <p className="text-panel text-muted-foreground">Drop {UPLOAD_FORMAT_NAMES} files here</p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={onPick} />
      </div>
      <ErrorNote error={rejectionMessage(rejected)} />
    </div>
  );
}
