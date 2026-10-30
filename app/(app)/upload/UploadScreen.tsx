"use client";

import { useState } from "react";
import { Section } from "@/app/(app)/_components/bits";
import { reportTutorialAction } from "@/components/tutorial";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { UploadItem } from "@/components/upload/UploadItem";
import { RecentUploads } from "./RecentUploads";
import { AddLink } from "@/components/upload/AddLink";
import { Button } from "@/components/ui/button";
import { optionsOnCount, UploadOptions } from "@/components/upload/UploadOptions";
import type { UploadOptions as Options } from "@/lib/ingest/uploadOptions";

// Stable key for a chosen file (the same file picked twice is listed once)
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

// UPLOAD SCREEN: the dropzone, one row per chosen file, then recent uploads.
// `initialOptions`: the space's upload switches, read on the server
export function UploadScreen({ initialOptions }: { initialOptions: Options }) {
  const [files, setFiles] = useState<File[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [options, setOptions] = useState(initialOptions);
  const optionsOn = optionsOnCount(options);
  const addFiles = (picked: File[]) => {
    reportTutorialAction("file-chosen");
    setFiles((current) => {
      const known = new Set(current.map(fileKey));
      return [...current, ...picked.filter((file) => !known.has(fileKey(file)))];
    });
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <UploadDropzone onFiles={addFiles}>
          <Button variant="outline" size="sm" data-tour="upload-link" aria-expanded={linkOpen} aria-controls="add-link-form" onClick={() => setLinkOpen(!linkOpen)}>
            Add link
          </Button>
          <Button variant="outline" size="sm" aria-expanded={optionsOpen} aria-controls="upload-options" onClick={() => setOptionsOpen(!optionsOpen)}>
            {optionsOn ? `Options (${optionsOn} on)` : "Options"}
          </Button>
        </UploadDropzone>
        {linkOpen ? <AddLink onClose={() => setLinkOpen(false)} /> : null}
        {optionsOpen ? <UploadOptions options={options} onChange={setOptions} onClose={() => setOptionsOpen(false)} /> : null}
      </div>
      {files.length > 0 ? (
        <Section title="Chosen files">
          <ul>
            {files.map((file) => (
              <UploadItem key={fileKey(file)} file={file} />
            ))}
          </ul>
        </Section>
      ) : null}
      <div data-tour="upload-recent"><RecentUploads /></div>
    </div>
  );
}
