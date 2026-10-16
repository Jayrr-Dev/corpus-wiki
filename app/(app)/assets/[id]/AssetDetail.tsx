"use client";

import { useMemo, type ReactNode } from "react";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { ErrorNote, Facts, Note, QueryState, Quote, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { formatDate, formatLocation, readablePassage } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { useAsset, usePassages, useSource } from "@/lib/queries";
import { useActionsForPassages, useUnitSummaries } from "@/lib/queries/screens";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { describeAssets } from "@/lib/server-actions/assets";
import { type Asset, ASSET_KIND_LABEL, AssetPlayer, assetSrc, assetTitle, TagChip } from "../AssetMedia";

// ASSET DETAIL: the media, the AI's description and tags, where it came from, the claims it
// backs, and the source text it was read into
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
  const facts: [string, ReactNode][] = [["Kind", ASSET_KIND_LABEL[asset.kind]]];
  if (source) facts.push(["Source", <TextLink key="source" href={`/sources/${source.id}`}>{source.title}</TextLink>]);
  if (asset.figure_number) facts.push(["Place", `Figure ${asset.figure_number} in the source`]);
  if (source) facts.push(["Source date", <span key="date" className="font-mono">{formatDate(source.source_date)}</span>]);
  if (asset.described_at) facts.push(["Described", <span key="described"><DateTime iso={asset.described_at} />{asset.model ? <span className="text-faint"> · {asset.model}</span> : null}</span>]);
  facts.push(["File", <a key="file" href={assetSrc(asset)} target="_blank" rel="noreferrer" className="text-link hover:underline">Open original</a>]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold">{title}</h1>
          <DescribeAgainButton asset={asset} />
        </div>
        <AssetPlayer asset={asset} alt={title} />
        {asset.description ? <p className="text-body">{asset.description}</p> : <Note>Not described yet. Describe it to get a title, a description and tags.</Note>}
        {asset.tags.length > 0 && <div className="flex flex-wrap gap-1">{asset.tags.map((tag) => <TagChip key={tag} tag={tag} />)}</div>}
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

// DESCRIBE AGAIN: the Media analyst rewrites this asset's title, description and tags
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
