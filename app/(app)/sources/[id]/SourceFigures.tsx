"use client";

import { Note, QueryState, Section } from "@/app/(app)/_components/bits";
import { ImageViewer } from "@/components/preview";
import { asObject, readString } from "@/app/(app)/_lib/format";
import type { Tables } from "@/lib/database/types";
import { embeddedFigureSrc } from "@/lib/living-page/articleEvidence";
import { usePassages } from "@/lib/queries";

// A PICTURE READ FROM THE FILE (a .docx figure): its stored path and the passages describing it, in order
export type SourceFigure = { path: string; number: number; caption: string; passages: Tables<"passages">[] };

export function figurePathOf(passage: Tables<"passages">): string | null {
  return readString(asObject(passage.location), "figure");
}

// Groups the passages by the picture they describe; the first one starts "Figure n: <what it shows>."
export function sourceFigures(passages: Tables<"passages">[]): SourceFigure[] {
  const byPath = new Map<string, Tables<"passages">[]>();
  for (const passage of passages) {
    const path = figurePathOf(passage);
    if (path) byPath.set(path, [...(byPath.get(path) ?? []), passage]);
  }
  return [...byPath].map(([path, list], index) => {
    const match = /^Figure (\d+):\s*/.exec(list[0]!.text);
    const rest = match ? list[0]!.text.slice(match[0].length) : list[0]!.text;
    return { path, number: match ? Number(match[1]) : index + 1, caption: rest.split(/(?<=\.)\s/)[0] ?? rest, passages: list };
  });
}

// FIGURES: every picture captured from the file, as a thumbnail that opens the full picture,
// its caption, and a link to the passages that describe it
export function SourceFigures({ sourceId }: { sourceId: string }) {
  const passages = usePassages({ filters: { source_id: sourceId } });
  const figures = sourceFigures(passages.data ?? []);
  if (passages.isSuccess && figures.length === 0) return null;
  return (
    <Section title={`Figures (${figures.length})`}>
      <QueryState query={passages}>
        <Note>Pictures read from the file. Their descriptions are passages, so claims can cite them.</Note>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {figures.map((figure) => (
            <li key={figure.path} className="flex gap-3 rounded-md border p-2">
              <FigureThumbnail sourceId={sourceId} figure={figure} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs font-medium">Figure {figure.number}</p>
                <p className="line-clamp-3 text-panel">{figure.caption}</p>
                <p className="mt-auto flex flex-wrap gap-x-3 gap-y-0.5 text-xs whitespace-nowrap">
                  <ImageViewer src={embeddedFigureSrc(sourceId, figure.path)} title={`Figure ${figure.number}`}>
                    <button type="button" className="text-link hover:underline">Open picture</button>
                  </ImageViewer>
                  <a href={`#passage-${figure.passages[0]!.id}`} className="text-link hover:underline">
                    {figure.passages.length === 1 ? `Passage #${figure.passages[0]!.position}` : `Passages #${figure.passages[0]!.position}–${figure.passages.at(-1)!.position}`}
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}

// THUMBNAIL: the stored picture, small, opening full size in the image viewer
export function FigureThumbnail({ sourceId, figure, size = "md" }: { sourceId: string; figure: Pick<SourceFigure, "path" | "number">; size?: "sm" | "md" }) {
  const src = embeddedFigureSrc(sourceId, figure.path);
  return (
    <ImageViewer src={src} title={`Figure ${figure.number}`}>
      <button type="button" aria-label={`View figure ${figure.number}`} className="shrink-0 cursor-zoom-in self-start overflow-hidden rounded border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect, not an optimizable asset */}
        <img src={src} alt={`Figure ${figure.number}`} loading="lazy" className={size === "sm" ? "h-14 w-20 object-contain" : "h-20 w-28 object-contain"} />
      </button>
    </ImageViewer>
  );
}
