"use client";

import Link from "next/link";
import { Images, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { DialogForm } from "@/components/actions/DialogForm";
import { MoreIcon } from "@/components/icons";
import { useServerAction } from "@/components/actions/useServerAction";
import { Loader } from "@/components/standard/loader";
import { startProgress } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAssets, useSources } from "@/lib/queries";
import { useAssetUsage } from "@/lib/queries/assetUsage";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { ASSET_TYPE_LABEL, ASSET_TYPES, type AssetType, normalizeTag, tagKey } from "@/lib/assets/tags";
import { describeAssets, permanentlyDeleteAsset, renameAssetTag, setAssetDeleted, unlinkAsset } from "@/lib/server-actions/assets";
import { cn } from "@/lib/utils";
import { type Asset, ASSET_KIND_LABEL, AssetThumbnail, assetTitle, TagChip } from "./AssetMedia";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en");
// Tags offered as filters: the most used ones
const TAG_FILTERS = 24;

// ASSETS (/assets): every picture, video and sound clip the sources brought in, with the
// AI's title, description, type and tags; search, a filter per kind, per type and per tag
// (each tag can be renamed or merged into another), and a pass that finds and describes new ones
export function AssetsScreen() {
  useRealtimeInvalidation("assets");
  const assets = useAssets();
  const sources = useSources();
  const usage = useAssetUsage();
  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const placement of usage.data ?? []) counts.set(placement.assetId, (counts.get(placement.assetId) ?? 0) + 1);
    return counts;
  }, [usage.data]);
  const sourceById = useMemo(() => new Map((sources.data ?? []).map((source) => [source.id, source])), [sources.data]);
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [origin, setOrigin] = useState<Asset["origin"] | null>(null);
  const [kind, setKind] = useState<Asset["kind"] | null>(null);
  const [type, setType] = useState<AssetType | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  // Assets of archived sources stay with their source, off this page
  const all = useMemo(() => (assets.data ?? []).filter((asset) => Boolean(asset.deleted_at) === showDeleted && !sourceById.get(asset.source_id ?? "")?.archived_at), [assets.data, sourceById, showDeleted]);
  const kinds = (["image", "video", "audio"] as const).map((name) => [name, all.filter((asset) => asset.kind === name).length] as const).filter(([, count]) => count > 0);
  const types = ASSET_TYPES.map((name) => [name, all.filter((asset) => asset.asset_type === name).length] as const).filter(([, count]) => count > 0);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of all) for (const tag of asset.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [all]);
  const shownTags = [...tags.filter((tag) => !tagCounts.slice(0, TAG_FILTERS).some(([name]) => name === tag)).map((tag) => [tag, 0] as const), ...tagCounts.slice(0, TAG_FILTERS)];
  const toggleTag = (tag: string) => setTags(tags.includes(tag) ? tags.filter((other) => other !== tag) : [...tags, tag]);
  // A renamed tag stays selected under its new name
  const renamed = (from: string, to: string) => setTags((selected) => selected.includes(from) ? [...new Set(selected.map((tag) => (tag === from ? to : tag)))] : selected);

  const needle = normalize(search.trim());
  const shown = all.filter((asset) => Boolean(asset.deleted_at) === showDeleted && (!kind || asset.kind === kind)
    && (!origin || asset.origin === origin)
    && (!type || asset.asset_type === type)
    && tags.every((tag) => asset.tags.includes(tag))
    && (!needle || normalize([asset.title ?? "", asset.description ?? "", asset.asset_type ?? "", asset.origin, asset.generated_by ?? "", ...asset.tags, sourceById.get(asset.source_id ?? "")?.title ?? ""].join(" ")).includes(needle)));
  const undescribed = all.filter((asset) => !asset.described_at).length;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-panel text-muted-foreground">Media from your sources and generated illustrations, described, tagged and available across your workspace.</p>
        <DescribeButton undescribed={undescribed} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1" aria-label="Asset origin">
          <FilterChip active={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>Deleted</FilterChip>
          <FilterChip active={origin === null} onClick={() => setOrigin(null)}>All origins</FilterChip>
          <FilterChip active={origin === "source"} onClick={() => setOrigin("source")}>From sources</FilterChip>
          <FilterChip active={origin === "external"} onClick={() => setOrigin("external")}>External</FilterChip>
          <FilterChip active={origin === "generated"} onClick={() => setOrigin("generated")}>Generated <span className="text-faint">{all.filter((a) => a.origin === "generated").length}</span></FilterChip>
        </div>
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
        {types.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Types of assets">
            <FilterChip active={type === null} onClick={() => setType(null)}>Any type</FilterChip>
            {types.map(([name, count]) => (
              <FilterChip key={name} active={type === name} onClick={() => setType(type === name ? null : name)}>
                {ASSET_TYPE_LABEL[name]} <span className="text-faint">{count}</span>
              </FilterChip>
            ))}
          </div>
        )}
        {shownTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
            {shownTags.map(([tag]) => (
              <TagFilter key={tag} tag={tag} active={tags.includes(tag)} onClick={() => toggleTag(tag)} tagCounts={tagCounts} onRenamed={renamed} />
            ))}
            {tags.length > 0 && <Button size="xs" variant="ghost" onClick={() => setTags([])}>Clear tags</Button>}
          </div>
        )}
      </div>

      <ErrorNote error={assets.error?.message ?? sources.error?.message} />
      {showDeleted ? <p className="text-xs text-muted-foreground">Unused assets are permanently deleted after 7 days. Assets still used anywhere in the app are kept until those uses are removed. Use an asset’s ⋯ menu to restore it or permanently delete it now.</p> : null}
      {assets.isPending ? <div className="py-10"><Loader /></div> : null}
      {!assets.isPending && shown.length === 0 ? (
        <div className="py-16 text-center">
          <Images className="mx-auto mb-4 size-7 text-muted-foreground" />
          <p className="text-panel font-medium">{all.length ? "No matching assets" : "No assets yet"}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {all.length ? "Try another word, or clear the filters." : "Upload images, videos, or Word documents with pictures; their media shows up here."}
          </p>
          {all.length > 0 && <Button variant="ghost" className="mt-4" onClick={() => { setSearch(""); setOrigin(null); setKind(null); setType(null); setTags([]); }}>Clear filters</Button>}
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((asset) => (
          <li key={asset.id}>
            <AssetCard asset={asset} usageCount={usage.data ? usageCounts.get(asset.id) ?? 0 : undefined} usageError={usage.isError} sourceTitle={asset.origin === "generated" ? "Generated by Composer" : asset.origin === "external" ? "External image" : sourceById.get(asset.source_id ?? "")?.title} activeTags={tags} onTag={toggleTag} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ONE ASSET: thumbnail, title, where it came from, its tags (each one filters the page)
function AssetCard({ asset, usageCount, usageError, sourceTitle, activeTags, onTag }: { asset: Asset; usageCount: number | undefined; usageError: boolean; sourceTitle: string | undefined; activeTags: string[]; onTag: (tag: string) => void }) {
  const title = assetTitle(asset, sourceTitle);
  const deletion = useServerAction(setAssetDeleted, { refreshTables: ["assets"] });
  const purge = useServerAction(permanentlyDeleteAsset);
  const unlink = useServerAction(unlinkAsset);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  return (
    <>
    <article className="relative flex h-full flex-col overflow-hidden rounded-md border transition-colors hover:border-link/40">
      <AssetThumbnail asset={asset} alt={title} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className={cn("text-xs", usageCount ? "font-medium text-link" : "text-faint")}>
          {usageError ? "Usage unavailable" : usageCount === undefined ? "Checking usage…" : usageCount ? `Used in ${usageCount} ${usageCount === 1 ? "place" : "places"}` : "Not used anywhere"}
        </p>
        {deletion.error ? <p role="alert" className="relative z-10 text-xs text-destructive">{deletion.error}</p> : null}
        <div className="flex items-start justify-between gap-2">
          <Link href={`/assets/${asset.id}`} className="min-w-0 line-clamp-2 text-panel font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none">
            {title}
          </Link>
      <div className="relative z-10 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Actions for ${title}`} disabled={deletion.isPending} className="flex size-5 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><MoreIcon className="size-3.5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void deletion.run(asset.id, !asset.deleted_at)} variant={asset.deleted_at ? "default" : "destructive"}>{asset.deleted_at ? "Restore" : "Delete"}</DropdownMenuItem>
            {asset.deleted_at && asset.origin !== "source" ? <DropdownMenuItem disabled={!usageCount || usageError || unlink.isPending} onSelect={() => setConfirmUnlink(true)}>Unlink</DropdownMenuItem> : null}
            {asset.deleted_at ? <DropdownMenuItem variant="destructive" disabled={usageCount !== 0 || usageError || purge.isPending} onSelect={() => setConfirmPurge(true)}>Permanently delete</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
        </div>
        <p className="truncate text-xs text-faint">
          {asset.asset_type ? ASSET_TYPE_LABEL[asset.asset_type] : ASSET_KIND_LABEL[asset.kind]}{asset.figure_number ? ` · Figure ${asset.figure_number}` : ""}{sourceTitle ? ` · ${sourceTitle}` : ""}
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
    <Dialog open={confirmPurge} onOpenChange={setConfirmPurge}>
      <DialogContent>
        <DialogForm title="Permanently delete asset?" description={`“${title}” and its stored file will be removed permanently. This cannot be undone. Assets still in use cannot be permanently deleted.`} submitLabel="Permanently delete" isDestructive isPending={purge.isPending} error={purge.error} onSubmit={async () => { const result = await purge.run(asset.id); if (result.ok) setConfirmPurge(false); }} />
      </DialogContent>
    </Dialog>
    <Dialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
      <DialogContent>
        <DialogForm title="Unlink asset?" description={`Remove “${title}” from articles and stakeholder cards, including saved illustration versions. The image stays in Deleted. You can then permanently delete it, or let cleanup remove it after 7 days from deletion. Restoring the image will not restore these links.`} submitLabel="Unlink" isDestructive isPending={unlink.isPending} error={unlink.error} onSubmit={async () => { const result = await unlink.run(asset.id); if (result.ok) setConfirmUnlink(false); }} />
      </DialogContent>
    </Dialog>
    </>
  );
}

// A TAG FILTER: the tag (filters the page) and, inside the same chip, a small menu to rename it
// or merge it into another tag (faint until the chip is hovered or focused). The dialog lives
// outside the menu so it stays open after the menu closes.
function TagFilter({ tag, active, onClick, tagCounts, onRenamed }: {
  tag: string; active: boolean; onClick: () => void; tagCounts: (readonly [string, number])[]; onRenamed: (from: string, to: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <span className={cn("group/tag inline-flex items-center gap-0.5 rounded border pr-0.5 text-xs transition-colors",
      active ? "border-link/40 bg-link/15 text-link" : "text-muted-foreground hover:border-link/40")}>
      <button type="button" aria-pressed={active} onClick={onClick}
        className="rounded-l py-0.5 pl-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        {tag}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Actions for the tag ${tag}`}
            className="flex size-4 items-center justify-center rounded-sm opacity-40 transition-opacity group-hover/tag:opacity-100 group-focus-within/tag:opacity-100 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted data-[state=open]:opacity-100">
            <MoreIcon className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename or merge…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          {renaming && <RenameTagForm tag={tag} tagCounts={tagCounts} onDone={(to) => { onRenamed(tag, to); setRenaming(false); }} />}
        </DialogContent>
      </Dialog>
    </span>
  );
}

// RENAME OR MERGE: a new name renames the tag on every asset; an existing tag's name merges the two
function RenameTagForm({ tag, tagCounts, onDone }: { tag: string; tagCounts: (readonly [string, number])[]; onDone: (to: string) => void }) {
  const rename = useServerAction(renameAssetTag, { progress: { title: "Renaming the tag" } });
  const [name, setName] = useState(tag);
  const count = tagCounts.find(([other]) => other === tag)?.[1] ?? 0;
  const target = normalizeTag(name);
  const existing = target && target !== tag ? tagCounts.find(([other]) => other === target) ?? tagCounts.find(([other]) => other !== tag && tagKey(other) === tagKey(target)) : undefined;
  const listId = `tags-for-${tagKey(tag)}`;
  return (
    <DialogForm
      title={`Rename or merge "${tag}"`}
      description={`Changes it on ${count} asset${count === 1 ? "" : "s"}. Pick a tag already in use to merge the two. The Media analyst uses the new name from now on.`}
      submitLabel={existing ? `Merge into "${existing[0]}"` : "Rename"}
      isPending={rename.isPending}
      error={rename.error}
      isDisabled={!target || target === tag}
      onSubmit={async () => {
        const result = await rename.run(tag, existing?.[0] ?? name);
        if (result.ok) onDone(result.tag);
      }}
    >
      <Input aria-label="New tag name" value={name} onChange={(event) => setName(event.target.value)} list={listId} autoFocus />
      <datalist id={listId}>{tagCounts.filter(([other]) => other !== tag).map(([other]) => <option key={other} value={other} />)}</datalist>
      {existing ? <p className="text-xs text-muted-foreground">&quot;{existing[0]}&quot; is on {existing[1]} asset{existing[1] === 1 ? "" : "s"}; the two become one tag.</p> : null}
    </DialogForm>
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
