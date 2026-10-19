"use client";
import { MediaImage } from "@/components/preview/MediaImage";


import { ImageViewer } from "@/components/preview";
import type { ArticleFigure as Figure } from "@/lib/living-page/articleEvidence";

// ARTICLE FIGURE: an image or video source beside the paragraph that first cites it, captioned
// with the AI-written description it was read as. Floats right on wide screens (like a
// Wikipedia thumbnail), full width on phones. The reference number leads to the bibliography.
export function ArticleFigure({ figure }: { figure: Figure }) {
  return (
    <figure className="mb-3 w-full rounded-md border bg-card p-2 sm:float-right sm:clear-right sm:mb-2 sm:ml-5 sm:w-64">
      {figure.kind === "video" ? (
        <video src={figure.src} controls preload="metadata" aria-label={figure.title} className="w-full rounded-sm bg-black" />
      ) : (
        <ImageViewer src={figure.src} title={figure.title}>
          <button type="button" aria-label={`View ${figure.title}`} className="block w-full cursor-zoom-in">
            <MediaImage src={figure.src} alt={figure.caption} sizes="(max-width: 640px) 100vw, 256px" loading="lazy" className="h-auto w-full rounded-sm" />
          </button>
        </ImageViewer>
      )}
      <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">
        {figure.caption}
        <sup className="ml-0.5"><a href={`#reference-${figure.referenceNumber}`} aria-label={`Source ${figure.referenceNumber}: ${figure.title}`} className="text-link hover:underline">[{figure.referenceNumber}]</a></sup>
      </figcaption>
    </figure>
  );
}
