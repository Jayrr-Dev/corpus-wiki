"use client";
import { MediaImage } from "@/components/preview/MediaImage";

import { cn } from "@/lib/utils";
import { ImageViewer } from "@/components/preview";
import type { ShownIllustration } from "@/lib/composer/types";

export function ComposerFigure({ figure, standalone = false }: { figure: ShownIllustration; standalone?: boolean }) {
  const words = figure.caption.trim().split(/\s+/);
  const isLong = words.length > 22;
  const firstSentence = figure.caption.match(/^.*?[.!?](?:\s|$)/)?.[0].trim();
  const shortCaption = firstSentence && firstSentence.split(/\s+/).length <= 22
    ? firstSentence : `${words.slice(0, 18).join(" ")}…`;
  return <figure className={cn("mb-3 w-full overflow-hidden border bg-card p-1", standalone ? "m-0" : "max-w-72 sm:float-right sm:clear-right sm:mb-2 sm:ml-5 sm:w-64")} aria-label={figure.learningGoal}>
    <ImageViewer src={figure.src} title={figure.learningGoal}>
      <button type="button" className="block w-full cursor-zoom-in bg-white" aria-label={`Enlarge illustration: ${figure.learningGoal}`}>
        <MediaImage src={figure.src} alt={figure.alt} sizes={figure.assetType === "logo" ? "96px" : "(max-width: 640px) 100vw, 256px"} loading="lazy" className={figure.assetType === "logo" ? "mx-auto my-4 h-auto max-h-24 max-w-24 object-contain" : "mx-auto h-auto w-full"} />
      </button>
    </ImageViewer>
    <figcaption className="relative px-0.5 pr-3 pt-1 text-xs leading-4 text-muted-foreground">
      {isLong ? <details><summary className="cursor-pointer list-none">{shortCaption} <span className="text-link hover:underline">Details</span></summary><p className="mt-1">{figure.caption}</p></details> : figure.caption}
      {figure.evidence[0] ? <a href={`#line-${figure.evidence[0]}`} aria-label="Composer illustration based on article text" className="absolute right-0 bottom-0 text-link hover:underline">↗</a> : null}
      {figure.assetId ? <a href={`/assets/${figure.assetId}`} className="mt-1 block text-link hover:underline">Image source and credits</a> : null}
    </figcaption>
  </figure>;
}
