"use client";

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
        <a href={figure.src} target="_blank" rel="noreferrer" aria-label={`Open ${figure.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs; next/image cannot cache them */}
          <img src={figure.src} alt={figure.caption} loading="lazy" className="w-full rounded-sm" />
        </a>
      )}
      <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">
        {figure.caption}
        <sup className="ml-0.5"><a href={`#reference-${figure.referenceNumber}`} aria-label={`Source ${figure.referenceNumber}: ${figure.title}`} className="text-link hover:underline">[{figure.referenceNumber}]</a></sup>
      </figcaption>
    </figure>
  );
}
