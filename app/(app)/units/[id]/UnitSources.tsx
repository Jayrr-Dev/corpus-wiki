"use client";

import { Note, QueryState, Quote, Section, TextLink } from "@/app/(app)/_components/bits";
import { formatDate, formatLocation } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { figurePathOf } from "@/app/(app)/sources/[id]/SourceFigures";
import { ImageViewer } from "@/components/preview";
import type { Tables } from "@/lib/database/types";
import { mediaKindOf } from "@/lib/ingest/formats";
import { embeddedFigureSrc, sourceFileSrc } from "@/lib/living-page/articleEvidence";
import { useRevisions } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";

// SOURCES: every passage any revision of the unit cites, with its source
export function UnitSources({ unitId }: { unitId: string }) {
  const cited = useUnitPassages(unitId);
  return (
    <Section title={`Sources (${cited.passages.length})`}>
      <PassageList cited={cited} />
    </Section>
  );
}

export type UnitPassages = ReturnType<typeof useUnitPassages>;

// CITED PASSAGES: the unit's revisions → the passages they cite → those passages' sources
export function useUnitPassages(unitId: string) {
  const revisions = useRevisions({ filters: { unit_id: unitId } });
  const passages = useRowsByIds("passages", (revisions.data ?? []).flatMap((revision) => revision.passage_ids));
  const sources = useRowsByIds("sources", (passages.data ?? []).map((passage) => passage.source_id));
  const sourceById = new Map((sources.data ?? []).map((source) => [source.id, source]));
  return { state: readsState([revisions, passages, sources]), passages: passages.data ?? [], sourceById };
}

// PASSAGE LIST: each cited passage with its source, or a note when there are none
export function PassageList({ cited }: { cited: UnitPassages }) {
  return (
    <QueryState query={cited.state}>
      {cited.passages.length === 0 ? <Note>No passages cited (a person&apos;s direct edit).</Note> : null}
      <ul className="flex flex-col gap-3">
        {cited.passages.map((passage, index) => {
          const source = cited.sourceById.get(passage.source_id);
          // A picture shows once, on the first passage read from it
          const picture = pictureOf(passage, source);
          const isFirst = picture && !cited.passages.slice(0, index).some((earlier) => pictureOf(earlier, cited.sourceById.get(earlier.source_id))?.src === picture.src);
          return <PassageItem key={passage.id} passage={passage} source={source} picture={picture} showsThumbnail={Boolean(isFirst)} />;
        })}
      </ul>
    </QueryState>
  );
}

type PassageItemProps = { passage: Tables<"passages">; source: Tables<"sources"> | undefined; picture: PassagePictureInfo | null; showsThumbnail: boolean };

// ONE CITED PASSAGE: source link, date and location, then the quoted text; a passage read from
// a picture (an image source, or a figure embedded in a document) shows that picture beside it
function PassageItem({ passage, source, picture, showsThumbnail }: PassageItemProps) {
  return (
    <li className="flex gap-3">
      {picture && showsThumbnail ? <PassagePicture picture={picture} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap gap-2 text-xs text-faint">
          <TextLink href={`/sources/${passage.source_id}`}>{source?.title ?? "Source"}</TextLink>
          <span className="font-mono">{formatDate(source?.source_date)}</span>
          <span>{formatLocation(passage.location)}</span>
          {picture ? <a href={picture.src} target="_blank" rel="noreferrer" className="text-link hover:underline">Open picture</a> : null}
        </p>
        <Quote>{passage.text}</Quote>
      </div>
    </li>
  );
}

type PassagePictureInfo = { src: string; title: string };

// The picture a passage was read from: the embedded figure it describes, else the image source itself
function pictureOf(passage: Tables<"passages">, source: Tables<"sources"> | undefined): PassagePictureInfo | null {
  const figurePath = figurePathOf(passage);
  const title = source?.title ?? "Picture";
  if (figurePath) return { src: embeddedFigureSrc(passage.source_id, figurePath), title };
  if (mediaKindOf(source?.mime_type) === "image") return { src: sourceFileSrc(passage.source_id), title };
  return null;
}

// THUMBNAIL: the picture, small, opening full size in the image viewer
function PassagePicture({ picture }: { picture: PassagePictureInfo }) {
  return (
    <ImageViewer src={picture.src} title={picture.title}>
      <button type="button" aria-label={`View ${picture.title}`} className="shrink-0 cursor-zoom-in self-start overflow-hidden rounded border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect, not an optimizable asset */}
        <img src={picture.src} alt={picture.title} loading="lazy" className="h-20 w-28 object-contain" />
      </button>
    </ImageViewer>
  );
}
