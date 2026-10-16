"use client";

import { Pencil, X } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { ErrorNote, Facts, Note, QueryState, Quote, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { formatDate, formatLocation, readablePassage } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { useServerAction } from "@/components/actions/useServerAction";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_TYPE_LABEL, ASSET_TYPES, type AssetEditableField, type AssetType } from "@/lib/assets/tags";
import { useAsset, useAssets, usePassages, useSource } from "@/lib/queries";
import { useActionsForPassages, useUnitSummaries } from "@/lib/queries/screens";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { describeAssets, editAsset, releaseAssetEdits } from "@/lib/server-actions/assets";
import { type Asset, ASSET_KIND_LABEL, AssetPlayer, assetSrc, assetTitle } from "../AssetMedia";

// ASSET DETAIL: the media, the AI's description, type and tags (a person can correct each;
// "Describe again" then leaves that field alone), where it came from, the claims it backs,
// and the source text it was read into
export function AssetDetail({ assetId }: { assetId: string }) {
  useRealtimeInvalidation("assets", { filter: `id=eq.${assetId}` });
  const query = useAsset(assetId);
  const asset = query.data;
  return (
    <QueryState query={query}>
      {asset ? <AssetBody asset={asset} /> : <Note>No asset with this id. Its source may have been deleted.</Note>}
    </QueryState>
  );
}

function AssetBody({ asset }: { asset: Asset }) {
  const source = useSource(asset.source_id).data;
  const title = assetTitle(asset, source?.title);
  const facts: [string, ReactNode][] = [["Kind", ASSET_KIND_LABEL[asset.kind]], ["Type", <AssetTypeSelect key="type" asset={asset} />]];
  if (source) facts.push(["Source", <TextLink key="source" href={`/sources/${source.id}`}>{source.title}</TextLink>]);
  if (asset.figure_number) facts.push(["Place", `Figure ${asset.figure_number} in the source`]);
  if (source) facts.push(["Source date", <span key="date" className="font-mono">{formatDate(source.source_date)}</span>]);
  if (asset.described_at) facts.push(["Described", <span key="described"><DateTime iso={asset.described_at} />{asset.model ? <span className="text-faint"> · {asset.model}</span> : null}</span>]);
  facts.push(["File", <a key="file" href={assetSrc(asset)} target="_blank" rel="noreferrer" className="text-link hover:underline">Open original</a>]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <EditableTitle asset={asset} title={title} />
          <DescribeAgainButton asset={asset} />
        </div>
        <AssetPlayer asset={asset} alt={title} />
        <EditableDescription asset={asset} />
        <TagEditor asset={asset} />
        <EditedNote asset={asset} />
        <Facts items={facts} />
      </header>
      <AssetClaims asset={asset} />
      <AssetPassages asset={asset} />
    </div>
  );
}

// CLAIMS IT BACKS: the live claims taken from the passages that describe it, by title
function AssetClaims({ asset }: { asset: Asset }) {
  const actions = useActionsForPassages(asset.passage_ids);
  const unitIds = (actions.data ?? []).filter((action) => action.target_id && UNIT_ACTION_TYPES.has(action.type)).map((action) => action.target_id);
  const units = useUnitSummaries(unitIds);
  const live = useMemo(() => (units.data ?? []).filter((unit) => !unit.retired_at), [units.data]);
  return (
    <Section title={`Claims (${live.length})`}>
      <QueryState query={readsState([actions, units])}>
        {live.length === 0 ? <Note>No claims cite this asset yet.</Note> : (
          <ul className="flex flex-col gap-1.5">
            {live.map((unit) => <li key={unit.id} className="text-panel"><UnitLink unit={unit} /></li>)}
          </ul>
        )}
      </QueryState>
    </Section>
  );
}

// WHAT WAS READ FROM IT: the passages the vision or speech model wrote, linking to their place in the source
function AssetPassages({ asset }: { asset: Asset }) {
  const passages = usePassages({ filters: { source_id: asset.source_id } });
  const list = (passages.data ?? []).filter((passage) => asset.passage_ids.includes(passage.id));
  return (
    <Section title="Read from the asset">
      <QueryState query={passages}>
        {list.length === 0 ? <Note>No text was read from this asset.</Note> : (
          <ol className="flex flex-col gap-3">
            {list.map((passage) => (
              <li key={passage.id} className="flex flex-col gap-1">
                <p className="flex gap-2 text-xs text-faint">
                  <TextLink href={`/sources/${asset.source_id}#passage-${passage.id}`} className="font-mono">#{passage.position}</TextLink>
                  <span>{formatLocation(passage.location)}</span>
                </p>
                <Quote>{readablePassage(passage.text)}</Quote>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

// DESCRIBE AGAIN: the Media analyst rewrites this asset's title, description, type and tags (not the ones a person edited)
function DescribeAgainButton({ asset }: { asset: Asset }) {
  const describe = useServerAction(describeAssets, { progress: { title: "Describing the asset" } });
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={describe.isPending} onClick={() => void describe.run({ ids: [asset.id] })}>
        {describe.isPending ? "Describing…" : asset.described_at ? "Describe again" : "Describe"}
      </Button>
      <ErrorNote error={describe.error} />
    </div>
  );
}

const FIELD_NAME: Record<AssetEditableField, string> = { title: "the title", description: "the description", tags: "the tags", asset_type: "the type" };

// TITLE: the AI's (or the file's) name for it, with a pencil to correct it
function EditableTitle({ asset, title }: { asset: Asset; title: string }) {
  const edit = useServerAction(editAsset, { progress: false });
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="flex items-start gap-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <EditButton label="Edit the title" onClick={() => setDraft(asset.title ?? title)} />
      </div>
    );
  }
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if ((await edit.run(asset.id, { title: draft })).ok) setDraft(null);
  };
  return (
    <form onSubmit={save} className="flex flex-1 flex-col gap-2">
      <Input aria-label="Title" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={200} autoFocus />
      <SaveCancel pending={edit.isPending} disabled={!draft.trim()} onCancel={() => setDraft(null)} />
      <ErrorNote error={edit.error} />
    </form>
  );
}

// DESCRIPTION: what the asset shows, with a pencil to correct it
function EditableDescription({ asset }: { asset: Asset }) {
  const edit = useServerAction(editAsset, { progress: false });
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="flex items-start gap-1">
        {asset.description ? <p className="text-body">{asset.description}</p> : <Note>{asset.described_at ? "No description." : "Not described yet. Describe it to get a title, a description, a type and tags."}</Note>}
        <EditButton label={asset.description ? "Edit the description" : "Write a description"} onClick={() => setDraft(asset.description ?? "")} />
      </div>
    );
  }
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if ((await edit.run(asset.id, { description: draft })).ok) setDraft(null);
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <Textarea aria-label="Description" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2_000} rows={3} autoFocus />
      <SaveCancel pending={edit.isPending} onCancel={() => setDraft(null)} />
      <ErrorNote error={edit.error} />
    </form>
  );
}

// TYPE: what kind of media it is, one value from the fixed list; a change saves at once
function AssetTypeSelect({ asset }: { asset: Asset }) {
  const edit = useServerAction(editAsset, { progress: false });
  return (
    <span className="inline-flex flex-col gap-1">
      <NativeSelect size="sm" aria-label="Type" value={asset.asset_type ?? ""} disabled={edit.isPending}
        onChange={(event) => { if (event.target.value) void edit.run(asset.id, { asset_type: event.target.value as AssetType }); }}>
        {!asset.asset_type && <NativeSelectOption value="">Not set</NativeSelectOption>}
        {ASSET_TYPES.map((type) => <NativeSelectOption key={type} value={type}>{ASSET_TYPE_LABEL[type]}</NativeSelectOption>)}
      </NativeSelect>
      <ErrorNote error={edit.error} />
    </span>
  );
}

// TAGS: remove one with its ×, add one by name (the tags already in use are suggested; the
// server folds a new one into a known tag when it is the same word in another form)
function TagEditor({ asset }: { asset: Asset }) {
  const edit = useServerAction(editAsset, { progress: false });
  const all = useAssets();
  const [draft, setDraft] = useState("");
  const known = useMemo(() => [...new Set((all.data ?? []).flatMap((other) => other.tags))].filter((tag) => !asset.tags.includes(tag)).sort(), [all.data, asset.tags]);
  const save = (tags: string[]) => edit.run(asset.id, { tags });
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    if ((await save([...asset.tags, draft])).ok) setDraft("");
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1" aria-label="Tags">
        {asset.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center rounded border pl-1.5 text-xs text-muted-foreground">
            {tag}
            <Tooltip content={`Remove "${tag}"`}>
              <button type="button" aria-label={`Remove the tag ${tag}`} disabled={edit.isPending}
                onClick={() => void save(asset.tags.filter((other) => other !== tag))}
                className="ml-0.5 rounded-r px-1 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <X aria-hidden="true" className="size-3" />
              </button>
            </Tooltip>
          </span>
        ))}
        <form onSubmit={add} className="inline-flex">
          <Input aria-label="Add a tag" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add tag…" list="asset-known-tags"
            disabled={edit.isPending} className="h-7 w-36" />
          <datalist id="asset-known-tags">{known.map((tag) => <option key={tag} value={tag} />)}</datalist>
        </form>
      </div>
      <ErrorNote error={edit.error} />
    </div>
  );
}

// WHAT A PERSON CHANGED: those fields stay through "Describe again" until handed back to the AI
function EditedNote({ asset }: { asset: Asset }) {
  const release = useServerAction(releaseAssetEdits, { progress: false });
  if (asset.edited_fields.length === 0) return null;
  const names = asset.edited_fields.map((field) => FIELD_NAME[field]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const them = asset.edited_fields.length === 1 && asset.edited_fields[0] !== "tags" ? "it" : "them";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>You edited {list}; &ldquo;Describe again&rdquo; keeps {them}.</span>
      <Button size="xs" variant="ghost" disabled={release.isPending} onClick={() => void release.run(asset.id)}>Let the AI rewrite {them}</Button>
      <ErrorNote error={release.error} />
    </div>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <Button type="button" size="icon-xs" variant="ghost" aria-label={label} onClick={onClick} className="mt-0.5 shrink-0">
        <Pencil />
      </Button>
    </Tooltip>
  );
}

function SaveCancel({ pending, disabled, onCancel }: { pending: boolean; disabled?: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={pending || disabled}>{pending ? "Saving…" : "Save"}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
