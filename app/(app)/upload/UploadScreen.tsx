"use client";

import { useState } from "react";
import { Section } from "@/app/(app)/_components/bits";
import { reportTutorialAction } from "@/components/tutorial";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { UploadItem } from "@/components/upload/UploadItem";
import { RecentUploads } from "./RecentUploads";

// Stable key for a chosen file (the same file picked twice is listed once)
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

// UPLOAD SCREEN: the dropzone, one row per chosen file, then recent uploads
export function UploadScreen() {
  const [files, setFiles] = useState<File[]>([]);
  const addFiles = (picked: File[]) => {
    reportTutorialAction("file-chosen");
    setFiles((current) => {
      const known = new Set(current.map(fileKey));
      return [...current, ...picked.filter((file) => !known.has(fileKey(file)))];
    });
  };
  return (
    <div className="flex flex-col gap-6">
      <UploadDropzone onFiles={addFiles} />
      {files.length > 0 ? (
        <Section title="Chosen files">
          <ul>
            {files.map((file) => (
              <UploadItem key={fileKey(file)} file={file} />
            ))}
          </ul>
        </Section>
      ) : null}
      <RecentUploads />
    </div>
  );
}
