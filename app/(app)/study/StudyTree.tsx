"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { outlineMark, TopicCover } from "@/components/knowledge/TopicCover";
import { Tooltip } from "@/components/standard/tooltip";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { SCOPE_KIND_LABELS } from "@/lib/knowledge/scopeTypes";
import { LEVEL_LABELS, LEVELS } from "@/lib/study/levels";
import type { SetSummary } from "@/lib/study/session";
import { filterStudyTree, practicedPct, type StudyTotals, type StudyTreeNode } from "@/lib/study/tree";
import { cn } from "@/lib/utils";
import { LevelBar } from "./LevelBar";

// The search box shows once the list is long enough to need it
const SEARCH_FROM = 7;

// RING: a small progress circle for the share practiced
function Ring({ percent, className }: { percent: number; className?: string }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 18 18" className={cn("size-4.5 shrink-0 -rotate-90", className)} aria-hidden>
      <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" className="stroke-muted" />
      {percent ? <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-link" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} /> : null}
    </svg>
  );
}

function DueChip({ due }: { due: number }) {
  if (!due) return null;
  return <span className="shrink-0 rounded-full bg-link/12 px-2 py-0.5 text-xs font-medium text-link tabular-nums">{due} due</span>;
}

// BRANCH STATS: share practiced and due (and the set count, on a top-level heading)
function BranchStats({ totals, showSets = false, className }: { totals: StudyTotals; showSets?: boolean; className?: string }) {
  const percent = practicedPct(totals);
  return (
    <span className={cn("flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums", className)}>
      {showSets ? <span>{totals.sets} set{totals.sets === 1 ? "" : "s"}</span> : null}
      <span className="flex items-center gap-1.5"><Ring percent={percent} />{percent}%</span>
      <DueChip due={totals.due} />
    </span>
  );
}

// SET ROW: one set as a link, with its practiced ring, due count and levels
function SetRow({ set, label }: { set: SetSummary; label: string }) {
  const levels = LEVELS.map((level) => `${LEVEL_LABELS[level]} ${set.levels[level]}`).join(", ");
  return (
    <Link href={`/study/${set.id}`} className="group/set -mx-2 flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
      <Tooltip content={`${set.practicedPct}% practiced. ${levels}.`}>
        <span className="flex"><Ring percent={set.practicedPct} /></span>
      </Tooltip>
      <span className="min-w-0 flex-1 text-panel group-hover/set:text-link sm:truncate">{label}</span>
      <DueChip due={set.due} />
      <LevelBar levels={set.levels} className="hidden w-16 sm:flex" />
    </Link>
  );
}

// A set on a topic is named by the topic; a part-coverage set also says how much
const setLabel = (set: SetSummary, name: string) => (set.coverage < 100 ? `${name} (top ${set.coverage}%)` : name);

function SetRows({ node, label }: { node: StudyTreeNode; label?: string }) {
  if (!node.sets.length) return null;
  return <div className="grid">{node.sets.map((set) => <SetRow key={set.id} set={set} label={setLabel(set, label ?? node.name)} />)}</div>;
}

// TOPIC LIST: deeper topics as a numbered outline (1, a, i), each with its sets
function TopicList({ nodes, level = 0 }: { nodes: StudyTreeNode[]; level?: number }) {
  if (!nodes.length) return null;
  return (
    <ol className="grid gap-0.5">
      {nodes.map((node, index) => (
        // the number is drawn here, not as a list marker, so it centers on the row's first line
        <li key={node.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start">
          <span aria-hidden className="flex h-8 items-center text-xs text-muted-foreground tabular-nums">{outlineMark(index, level)}.</span>
          <div className="min-w-0">
            {node.sets.length ? <SetRows node={node} /> : <span className="flex h-8 items-center text-panel text-muted-foreground">{node.name}</span>}
            <TopicList nodes={node.children} level={level + 1} />
          </div>
        </li>
      ))}
    </ol>
  );
}

// TOPIC CARD: a topic with its cover, its own sets and the topics under it
function TopicCard({ node }: { node: StudyTreeNode }) {
  return (
    <article className="flex min-w-0 overflow-hidden rounded-xl border bg-background shadow-xs">
      <TopicCover name={node.name} />
      <div className="grid min-w-0 flex-1 content-start gap-2 p-3 sm:p-4">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h4 className="min-w-0 truncate font-semibold">{node.name}</h4>
          <BranchStats totals={node.totals} />
        </header>
        <SetRows node={node} label={node.children.length ? `All of ${node.name}` : node.name} />
        <TopicList nodes={node.children} />
      </div>
    </article>
  );
}

// AREA: a second-level topic, as a panel of topic cards that folds away
function Area({ node, forceOpen }: { node: StudyTreeNode; forceOpen: boolean }) {
  const [open, setOpen] = useState(true);
  const leaves = node.children.filter((child) => !child.children.length);
  const branches = node.children.filter((child) => child.children.length);
  return (
    <Collapsible open={forceOpen || open} onOpenChange={setOpen} asChild>
      <div className="rounded-2xl border bg-muted/30">
      <CollapsibleTrigger asChild>
        <button type="button" className="group/area flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
          <span className="flex min-w-0 items-center gap-2">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/area:rotate-90" aria-hidden />
            <h3 className="truncate font-semibold">{node.name}</h3>
          </span>
          <BranchStats totals={node.totals} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
      <div className="grid gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
        {node.sets.length ? <div className="rounded-xl border bg-background px-4 py-2"><SetRows node={node} label={`All of ${node.name}`} /></div> : null}
        {branches.length ? <div className={cn("grid gap-3", branches.length > 1 && "lg:grid-cols-2")}>{branches.map((child) => <TopicCard key={child.id} node={child} />)}</div> : null}
        {leaves.length ? (
          <div className="grid gap-x-6 rounded-xl border bg-background px-4 py-2 md:grid-cols-2">
            {leaves.flatMap((child) => child.sets.map((set) => <SetRow key={set.id} set={set} label={setLabel(set, child.name)} />))}
          </div>
        ) : null}
      </div>
      </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ROOT: a top-level topic as a titled section of areas
function Root({ node, forceOpen }: { node: StudyTreeNode; forceOpen: boolean }) {
  return (
    <section className="grid gap-3">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{node.name}</h2>
        <BranchStats totals={node.totals} showSets />
      </header>
      {node.sets.length ? <div className="rounded-xl border px-4 py-2"><SetRows node={node} label={`All of ${node.name}`} /></div> : null}
      {node.children.map((child) => <Area key={child.id} node={child} forceOpen={forceOpen} />)}
    </section>
  );
}

// OTHER SOURCES: sets built from articles, entities or the glossary
function OtherSets({ sets }: { sets: SetSummary[] }) {
  if (!sets.length) return null;
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold tracking-tight">Other sources</h2>
      <div className="grid gap-x-6 rounded-xl border px-4 py-2 md:grid-cols-2">
        {sets.map((set) => (
          <div key={set.id} className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1"><SetRow set={set} label={set.title} /></div>
            <Badge variant="outline" className="shrink-0">{SCOPE_KIND_LABELS[set.scopeKind]}</Badge>
          </div>
        ))}
      </div>
    </section>
  );
}

// STUDY TREE: every set placed on the domain tree, with a search once the list grows
export function StudyTree({ roots, other }: { roots: StudyTreeNode[]; other: SetSummary[] }) {
  const [query, setQuery] = useState("");
  const total = roots.reduce((sum, root) => sum + root.totals.sets, 0) + other.length;
  const searching = query.trim().length > 0;
  const shown = filterStudyTree(roots, query);
  const shownOther = searching ? other.filter((set) => set.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : other;
  return (
    <div className="grid gap-8">
      {total >= SEARCH_FROM ? (
        <label className="flex max-w-sm items-center gap-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Find a topic</span>
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a topic" />
        </label>
      ) : null}
      {shown.map((root) => <Root key={root.id} node={root} forceOpen={searching} />)}
      <OtherSets sets={shownOther} />
      {searching && !shown.length && !shownOther.length ? <p className="text-panel text-muted-foreground">No topics match.</p> : null}
    </div>
  );
}
