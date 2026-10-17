"use client";

import { AudioLines, Film } from "lucide-react";
import { ImageViewer } from "@/components/preview";
import type { Tables } from "@/lib/database/types";
import { embeddedFigureSrc, sourceFileSrc } from "@/lib/living-page/articleEvidence";
import { cn } from "@/lib/utils";

export type Asset = Tables<"assets">;

// WHERE THE BYTES ARE SERVED: a picture inside a document through the figure route, else the source's own file
export function assetSrc(asset: Pick<Asset, "id" | "origin" | "source_id" | "storage_path" | "media_url">): string {
  if (asset.media_url) return asset.media_url;
  if (asset.origin === "generated") return `/api/assets/${asset.id}/generated`;
  return asset.storage_path.startsWith("figures/") ? embeddedFigureSrc(asset.source_id!, asset.storage_path) : sourceFileSrc(asset.source_id!);
}

// A NAME FOR AN ASSET NOT YET DESCRIBED: "Figure 2 of report.docx", or the file's own name
export function assetTitle(asset: Asset, sourceTitle: string | undefined): string {
  if (asset.title) return asset.title;
  if (asset.figure_number) return `Figure ${asset.figure_number}${sourceTitle ? ` of ${sourceTitle}` : ""}`;
  return sourceTitle ?? "Untitled asset";
}

export const ASSET_KIND_LABEL: Record<Asset["kind"], string> = { image: "Image", video: "Video", audio: "Audio" };

// THUMBNAIL FOR THE GRID: the picture itself, the video's first frame, or an audio glyph
export function AssetThumbnail({ asset, alt, className }: { asset: Asset; alt: string; className?: string }) {
  const src = assetSrc(asset);
  const box = cn("flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-muted", className);
  if (asset.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- a signed redirect, not an optimizable asset
    return <div className={cn(box, asset.origin !== "source" && "bg-white")}><img src={src} alt={alt} loading="lazy" className={asset.asset_type === "logo" ? "max-h-24 max-w-24 object-contain" : cn("size-full", asset.origin !== "source" ? "object-contain p-3" : "object-cover")} /></div>;
  }
  if (asset.kind === "video") {
    return (
      <div className={cn(box, "relative")}>
        <video src={`${src}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" aria-label={alt} />
        <Film aria-hidden="true" className="absolute right-2 bottom-2 size-4 text-white drop-shadow" />
      </div>
    );
  }
  return <div className={box}><AudioLines aria-label={alt} className="size-8 text-muted-foreground" /></div>;
}

// FULL VIEW FOR THE DETAIL PAGE: the picture (opening the zoomable viewer), or a player
export function AssetPlayer({ asset, alt }: { asset: Asset; alt: string }) {
  const src = assetSrc(asset);
  if (asset.kind === "video") return <video src={src} controls preload="metadata" className="max-h-[70vh] w-full rounded-md border bg-black" aria-label={alt} />;
  if (asset.kind === "audio") return <audio src={src} controls preload="metadata" className="w-full" aria-label={alt} />;
  return (
    <ImageViewer src={src} title={alt}>
      <button type="button" aria-label={`View ${alt} full size`} className="block w-full cursor-zoom-in overflow-hidden rounded-md border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect, not an optimizable asset */}
        <img src={src} alt={alt} className="mx-auto max-h-[70vh] object-contain" />
      </button>
    </ImageViewer>
  );
}

// ONE TAG; a link-like button when it filters
export function TagChip({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
  const style = cn("rounded border px-1.5 py-0.5 text-xs", active ? "border-link/40 bg-link/15 text-link" : "text-muted-foreground");
  if (!onClick) return <span className={style}>{tag}</span>;
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn(style, "hover:border-link/40 hover:text-foreground")}>{tag}</button>;
}
