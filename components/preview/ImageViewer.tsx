"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FilePreview } from "./FilePreview";

// IMAGE VIEWER: the child opens the picture full size in a wide dialog, drawn by FilePreview
// (with its Open in a new tab and Download buttons). The child must take a ref (a button).
export function ImageViewer({ src, title, children }: { src: string; title: string; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <FilePreview src={src} title={title} kind="image" height="min(75vh, 48rem)" className="mt-6" />
      </DialogContent>
    </Dialog>
  );
}
