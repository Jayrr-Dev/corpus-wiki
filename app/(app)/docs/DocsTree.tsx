"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { outlineMark, TopicCover } from "@/components/knowledge/TopicCover";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { DocsTreeNode } from "@/lib/docs/tree";
import type { DocSetSummary } from "@/lib/docs/types";
import { SCOPE_KIND_LABELS } from "@/lib/knowledge/scopeTypes";

// =====================================================================
// DOCS TREE: the Docs list laid out like the Study list. A top-level
// topic is a titled section, a second-level topic a panel that folds
// away, and each topic under it a card with a cover and its doc sets.
// =====================================================================

// SET ROW: one doc set as a link, with its state
function SetRow({ set }: { set: DocSetSummary }) {
  return (
    <div className="grid">
      <Link href={`/docs/${set.id}`} className="group/set -mx-2 flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="min-w-0 flex-1 text-panel group-hover/set:text-link sm:truncate">{set.title}</span>
        {set.status === "writing" ? <Badge variant="secondary">Writing…</Badge> : null}
        {set.stalePages ? <Badge variant="destructive">Sources changed</Badge> : null}
      </Link>
      {set.status === "failed" && set.error ? <p role="alert" className="pb-1 text-panel text-destructive">{set.error}</p> : null}
    </div>
  );
}

function SetRows({ sets }: { sets: DocSetSummary[] }) {
  if (!sets.length) return null;
  return <div className="grid">{sets.map((set) => <SetRow key={set.id} set={set} />)}</div>;
}

// TOPIC LIST: deeper topics as a numbered outline (1, a, i), each with its sets
function TopicList({ nodes, level = 0 }: { nodes: DocsTreeNode[]; level?: number }) {
  if (!nodes.length) return null;
  return (
    <ol className="grid gap-0.5">
      {nodes.map((node, index) => (
        <li key={node.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start">
          <span aria-hidden className="flex h-8 items-center text-xs text-muted-foreground tabular-nums">{outlineMark(index, level)}.</span>
          <div className="min-w-0">
            <span className="flex h-8 items-center text-panel font-medium">{node.name}</span>
            <SetRows sets={node.sets} />
            <TopicList nodes={node.children} level={level + 1} />
          </div>
        </li>
      ))}
    </ol>
  );
}

// TOPIC CARD: a topic with its cover, its own sets and the topics under it
function TopicCard({ node }: { node: DocsTreeNode }) {
  return (
    <article className="flex min-w-0 overflow-hidden rounded-xl border bg-background shadow-xs">
      <TopicCover name={node.name} />
      <div className="grid min-w-0 flex-1 content-start gap-2 p-3 sm:p-4">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h4 className="min-w-0 truncate font-semibold">{node.name}</h4>
        </header>
        <SetRows sets={node.sets} />
        <TopicList nodes={node.children} />
      </div>
    </article>
  );
}

// AREA: a second-level topic, as a panel of topic cards that folds away
function Area({ node }: { node: DocsTreeNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <div className="rounded-2xl border bg-muted/30">
        <CollapsibleTrigger asChild>
          <button type="button" className="group/area flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/area:rotate-90" aria-hidden />
              <h3 className="truncate font-semibold">{node.name}</h3>
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent asChild>
          <div className="grid gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
            {node.sets.length ? <div className="rounded-xl border bg-background px-4 py-2"><SetRows sets={node.sets} /></div> : null}
            {node.children.length ? <div className="grid gap-3">{node.children.map((child) => <TopicCard key={child.id} node={child} />)}</div> : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ROOT: a top-level topic as a titled section of areas
function Root({ node }: { node: DocsTreeNode }) {
  return (
    <section className="grid gap-3">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{node.name}</h2>
      </header>
      {node.sets.length ? <div className="rounded-xl border px-4 py-2"><SetRows sets={node.sets} /></div> : null}
      {node.children.map((child) => <Area key={child.id} node={child} />)}
    </section>
  );
}

// OTHER SOURCES: sets written from articles, entities or the glossary, or on a retired topic
function OtherSets({ sets }: { sets: DocSetSummary[] }) {
  if (!sets.length) return null;
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold tracking-tight">Other sources</h2>
      <div className="grid gap-x-6 rounded-xl border px-4 py-2 md:grid-cols-2">
        {sets.map((set) => (
          <div key={set.id} className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1"><SetRow set={set} /></div>
            <Badge variant="outline" className="shrink-0">{SCOPE_KIND_LABELS[set.scopeKind]}</Badge>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DocsTree({ roots, other }: { roots: DocsTreeNode[]; other: DocSetSummary[] }) {
  return (
    <div className="grid gap-8">
      {roots.map((root) => <Root key={root.id} node={root} />)}
      <OtherSets sets={other} />
    </div>
  );
}
