"use client";

import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FilePreview, PreviewHeaderButton } from "./FilePreview";

// IMAGE VIEWER: the child opens the picture full size in a wide dialog, drawn by FilePreview
// (with its Open in a new tab and Download buttons). Expand fills the window, for wide diagrams.
// The child must take a ref (a button).
export function ImageViewer({ src, title, children }: { src: string; title: string; children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <Dialog onOpenChange={(isOpen) => (isOpen ? null : setIsExpanded(false))}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className={cn(isExpanded ? "w-[calc(100vw-2rem)] max-w-none sm:max-w-none" : "sm:max-w-4xl")}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <FilePreview
          src={src}
          title={title}
          kind="image"
          // The dialog's padding, the gap above the preview and its header take about 8.75rem
          height={isExpanded ? "calc(100dvh - 8.75rem)" : "min(75vh, 48rem)"}
          className="mt-6"
          headerActions={
            <PreviewHeaderButton label={isExpanded ? "Exit full window" : "Expand to full window"} onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </PreviewHeaderButton>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
