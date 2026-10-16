"use client";

import Link from "next/link";
import { Images, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Loader } from "@/components/standard/loader";
import { startProgress } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAssets, useSources } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { describeAssets } from "@/lib/server-actions/assets";
import { cn } from "@/lib/utils";
import { type Asset, ASSET_KIND_LABEL, AssetThumbnail, assetTitle, TagChip } from "./AssetMedia";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en");
// Tags offered as filters: the most used ones
const TAG_FILTERS = 24;

// ASSETS (/assets): every picture, video and sound clip the sources brought in, with the
// AI's title, description and tags; search, a filter per kind and per tag, and a pass that
// finds and describes new ones
export function AssetsScreen() {
  useRealtimeInvalidation("assets");
  const assets = useAssets();
  const sources = useSources();
  const sourceById = useMemo(() => new Map((sources.data ?? []).map((source) => [source.id, source])), [sources.data]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Asset["kind"] | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  // Assets of archived sources stay with their source, off this page
  const all = useMemo(() => (assets.data ?? []).filter((asset) => !sourceById.get(asset.source_id)?.archived_at), [assets.data, sourceById]);
  const kinds = (["image", "video", "audio"] as const).map((name) => [name, all.filter((asset) => asset.kind === name).length] as const).filter(([, count]) => count > 0);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of all) for (const tag of asset.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [all]);
  const shownTags = [...tags.filter((tag) => !tagCounts.slice(0, TAG_FILTERS).some(([name]) => name === tag)).map((tag) => [tag, 0] as const), ...tagCounts.slice(0, TAG_FILTERS)];
  const toggleTag = (tag: string) => setTags(tags.includes(tag) ? tags.filter((other) => other !== tag) : [...tags, tag]);

  const needle = normalize(search.trim());
  const shown = all.filter((asset) => (!kind || asset.kind === kind)
    && tags.every((tag) => asset.tags.includes(tag))
    && (!needle || normalize([asset.title ?? "", asset.description ?? "", ...asset.tags, sourceById.get(asset.source_id)?.title ?? ""].join(" ")).includes(needle)));
  const undescribed = all.filter((asset) => !asset.described_at).length;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-panel text-muted-foreground">Pictures, videos and recordings from your sources, described and tagged by the AI and linked back to where they came from.</p>
        <DescribeButton undescribed={undescribed} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative w-full max-w-sm [&_input]:pl-8">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search assets" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, descriptions, tags, sources…" />
        </div>
        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-1" aria-label="Kinds of assets">
            <FilterChip active={kind === null} onClick={() => setKind(null)}>All <span className="text-faint">{all.length}</span></FilterChip>
            {kinds.map(([name, count]) => (
              <FilterChip key={name} active={kind === name} onClick={() => setKind(kind === name ? null : name)}>
                {ASSET_KIND_LABEL[name]}s <span className="text-faint">{count}</span>
              </FilterChip>
            ))}
          </div>
        )}
        {shownTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Tags">
            {shownTags.map(([tag]) => <TagChip key={tag} tag={tag} active={tags.includes(tag)} onClick={() => toggleTag(tag)} />)}
            {tags.length > 0 && <Button size="xs" variant="ghost" onClick={() => setTags([])}>Clear tags</Button>}
          </div>
        )}
      </div>

      <ErrorNote error={assets.error?.message ?? sources.error?.message} />
      {assets.isPending ? <div className="py-10"><Loader /></div> : null}
      {!assets.isPending && shown.length === 0 ? (
        <div className="py-16 text-center">
          <Images className="mx-auto mb-4 size-7 text-muted-foreground" />
          <p className="text-panel font-medium">{all.length ? "No matching assets" : "No assets yet"}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {all.length ? "Try another word, or clear the filters." : "Upload images, videos, or Word documents with pictures; their media shows up here."}
          </p>
          {all.length > 0 && <Button variant="ghost" className="mt-4" onClick={() => { setSearch(""); setKind(null); setTags([]); }}>Clear filters</Button>}
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((asset) => (
          <li key={asset.id}>
            <AssetCard asset={asset} sourceTitle={sourceById.get(asset.source_id)?.title} activeTags={tags} onTag={toggleTag} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ONE ASSET: thumbnail, title, where it came from, its tags (each one filters the page)
function AssetCard({ asset, sourceTitle, activeTags, onTag }: { asset: Asset; sourceTitle: string | undefined; activeTags: string[]; onTag: (tag: string) => void }) {
  const title = assetTitle(asset, sourceTitle);
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-md border transition-colors hover:border-link/40">
      <AssetThumbnail asset={asset} alt={title} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link href={`/assets/${asset.id}`} className="line-clamp-2 text-panel font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none">
          {title}
        </Link>
        <p className="truncate text-xs text-faint">
          {ASSET_KIND_LABEL[asset.kind]}{asset.figure_number ? ` · Figure ${asset.figure_number}` : ""}{sourceTitle ? ` · ${sourceTitle}` : ""}
        </p>
        {asset.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{asset.description}</p> : <p className="text-xs text-faint italic">Not described yet</p>}
        {asset.tags.length > 0 && (
          // Above the card's link, so a tag filters instead of opening the asset
          <div className="relative z-10 mt-auto flex flex-wrap gap-1 pt-1">
            {asset.tags.slice(0, 5).map((tag) => <TagChip key={tag} tag={tag} active={activeTags.includes(tag)} onClick={() => onTag(tag)} />)}
          </div>
        )}
      </div>
    </article>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-link/40 bg-link/15 text-link" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {children}
    </button>
  );
}

// DESCRIBE: finds media the sources brought in, then has the Media analyst title, describe and
// tag each one not yet described, a few batches per call until none remain
function DescribeButton({ undescribed }: { undescribed: number }) {
  const describe = useServerAction(describeAssets, { progress: false });
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const toast = startProgress("Describing assets", "Finding media in your sources…");
    let described = 0;
    let found = 0;
    try {
      for (;;) {
        const result = await describe.run();
        if (!result.ok) return toast.fail();
        described += result.described;
        found += result.found;
        if (result.remaining === 0) break;
        toast.update(`Described ${described}; ${result.remaining} to go…`, described / (described + result.remaining));
      }
      toast.done([found ? `${found} new asset${found === 1 ? "" : "s"} found` : "", described ? `${described} described and tagged` : "Every asset is up to date"].filter(Boolean).join(" · "));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
        {running ? "Describing…" : undescribed > 0 ? `Describe ${undescribed} new` : "Find new assets"}
      </Button>
      <ErrorNote error={describe.error} />
    </div>
  );
}
