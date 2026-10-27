"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Facts, QueryState } from "@/app/(app)/_components/bits";
import { PassageList, type UnitPassages, useUnitPassages } from "@/app/(app)/units/[id]/UnitSources";
import { formatDate, statusLabel } from "@/app/(app)/_lib/format";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { StatusGlyph } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Enums } from "@/lib/database/types";
import type { GraphNode } from "@/lib/graph";
import { useUnitSummariesByIds } from "@/app/(app)/units/unitSummaries";
import { type UnitSummary, useRowsByIds } from "@/lib/queries/screens";
import { EntityPreview, PagePreview, PreviewFooter } from "./NodePreviews";

// NODE PREVIEW: a clicked node's key facts without leaving the graph (shown in a preview card)
export function NodePreviewBody({ node }: { node: GraphNode }) {
  return node.kind === "unit" ? <UnitPreview node={node} /> : node.kind === "entity" ? <EntityPreview node={node} /> : <PagePreview node={node} />;
}

// KIND COLORS: one accent per unit kind, for the kind line
const KIND_COLOR: Record<Enums<"unit_kind">, string> = {
  fact: "text-link",
  definition: "text-stale",
  procedure: "text-applied",
  decision: "text-needs-you",
  preference: "text-muted-foreground",
};

// A unit counts as updated when it changed more than a minute after it was created
const UPDATED_AFTER_MS = 60_000;

// BODY: the kind line, the content, then entities, domains and dates
function UnitPreview({ node }: { node: GraphNode }) {
  const query = useUnitSummariesByIds([node.id]);
  const unit = query.data?.[0];
  // The current revision's author is who made the latest change
  const revision = useRowsByIds("revisions", [unit?.current_revision_id]).data?.[0];
  const label = useActorLabel();
  const author = revision ? label(revision.author, revision.author_id, revision.model_version) : undefined;
  const cited = useUnitPassages(node.id);
  const [showSources, setShowSources] = useState(false);
  const sourceCount = new Set(cited.passages.map((passage) => passage.source_id)).size;
  const sourcesButton = (
    <button type="button" className="text-link underline-offset-4 hover:underline" onClick={() => setShowSources(true)}>
      {sourceCount} {sourceCount === 1 ? "source" : "sources"}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div data-drag-handle className="flex cursor-move flex-col gap-2 pr-6">
        <KindLine node={node} />
        <h2 className="text-title font-semibold">{node.label}</h2>
      </div>
      <QueryState query={query}>
        <p className="text-body">{unit?.content ?? node.text}</p>
      </QueryState>
      <Facts items={facts(node, unit, author, sourceCount > 0 ? sourcesButton : null)} />
      <PreviewFooter>
        <Button asChild>
          <Link href={node.href}>Open page</Link>
        </Button>
      </PreviewFooter>
      <SourcesDialog open={showSources} onOpenChange={setShowSources} title={node.label} cited={cited} />
    </div>
  );
}

// SOURCES DIALOG: every passage the unit cites, each with a link to its source, stacked over the preview
function SourcesDialog({ open, onOpenChange, title, cited }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; cited: UnitPassages }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sources</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <PassageList cited={cited} />
      </DialogContent>
    </Dialog>
  );
}

// KIND LINE: "● ESTABLISHED FACT" above the title, in the kind's color
function KindLine({ node }: { node: GraphNode }) {
  const color = node.unitKind ? KIND_COLOR[node.unitKind] : undefined;
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {node.status ? <StatusGlyph status={node.status} className={color} /> : null}
      <span className={color}>{[node.status ? statusLabel(node.status) : null, node.unitKind].filter(Boolean).join(" ")}</span>
    </p>
  );
}

// FACTS: entities, domains, sources, valid-from and (when it changed since) updated and by whom, only the ones the unit has
function facts(node: GraphNode, unit: UnitSummary | undefined, author: string | undefined, sources: ReactNode): [string, ReactNode][] {
  const lines = (values: string[]) => values.map((value) => <span key={value} className="block">{value}</span>);
  const date = (value: string) => <span className="font-mono">{formatDate(value)}</span>;
  const wasUpdated = unit ? Date.parse(unit.last_changed_at) - Date.parse(unit.created_at) > UPDATED_AFTER_MS : false;
  const rows: [string, ReactNode | null][] = [
    ["Entities", node.entityNames.length > 0 ? lines(node.entityNames) : null],
    ["Domains", node.domainPaths.length > 0 ? lines(node.domainPaths) : null],
    ["Sources", sources],
    ["Valid from", unit ? date(unit.valid_from) : null],
    ["Updated", unit && wasUpdated ? date(unit.last_changed_at) : null],
    ["Updated by", wasUpdated && author ? author : null],
  ];
  return rows.filter(([, value]) => value !== null);
}
