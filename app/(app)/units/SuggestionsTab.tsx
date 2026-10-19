"use client";

import { ErrorNote, Note, QueryState, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { formatCount, formatDateTime, statusLabel } from "@/app/(app)/_lib/format";
import { useServerAction } from "@/components/actions/useServerAction";
import { DomainTreeSelect } from "@/components/actions/DomainTreeSelect";
import { EmptyState } from "@/components/EmptyState";
import { PageIcon } from "@/components/icons";
import { InfoPopover } from "@/components/standard/info-popover";
import { Tooltip } from "@/components/standard/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopoverDescription } from "@/components/ui/popover";
import type { Tables } from "@/lib/database/types";
import { useArticleSuggestions, useDomains, usePages, useSuggestionRuns, useUnitDomains } from "@/lib/queries";
import { type UnitSummary, useSectionKnowledge, useUnitSummaries } from "@/lib/queries/screens";
import { useRealtimeInvalidation } from "@/lib/realtime/useRealtimeInvalidation";
import { acceptArticleSuggestion, dismissArticleSuggestion, runArticleSuggestions } from "@/lib/server-actions/suggestions";
import { useMemo, useState } from "react";
import { unusedUnits } from "./UnusedUnits";
import { useUnitFilters } from "./useUnitFilters";

// Must match MAX_GROUPS_PER_RUN in lib/suggestions/run.ts
const MAX_AI_CALLS = 40;
const OPEN = new Set(["pending", "accepting", "failed", "stale"]);
const REFRESH = ["article_suggestions", "suggestion_runs"] as const;

type Suggestion = Tables<"article_suggestions">;
type Run = Tables<"suggestion_runs">;
type Section = { title: string; sectionId: string | null; unitIds: string[] };
type Signals = { cohesion?: number; links?: number; sharedEntities?: string[]; sharedDomains?: string[]; sharedSources?: number; closeness?: number | null;
  similarTitle?: { pageId: string; title: string } | null };

// RUN STATUS: what the newest run is doing, or how the last one ended
function RunStatus({ run }: { run: Run | undefined }) {
  if (!run) return <Note>No suggestions have been run yet.</Note>;
  if (run.state === "queued") return <StatusDot tone="muted" busy label="Starting…" />;
  if (run.state === "running") {
    const label = run.phase === "grouping" || !run.total ? "Grouping related knowledge…" : `Asking the AI about group ${Math.min(run.done + 1, run.total)} of ${run.total}…`;
    return <span className="flex flex-col gap-1"><StatusDot tone="muted" busy label={label} />{run.error ? <Note>Retrying after: {run.error}</Note> : null}</span>;
  }
  if (run.state === "failed") return <ErrorNote error={`The last run failed: ${run.error ?? "unknown error"}`} />;
  return (
    <span className="flex flex-col gap-1">
      <Note>Last run {formatDateTime(run.finished_at)}: {formatCount(run.total)} group(s), {formatCount(run.suggested)} suggestion(s).</Note>
      {run.error ? <ErrorNote error={run.error} /> : null}
    </span>
  );
}

function WhyGrouped({ signals }: { signals: Signals }) {
  const lines = [
    signals.cohesion !== undefined ? `Average similarity ${Math.round(signals.cohesion * 100)}%` : null,
    signals.links ? `${signals.links} link(s) between these units` : null,
    signals.sharedEntities?.length ? `About ${signals.sharedEntities.join(", ")}` : null,
    signals.sharedDomains?.length ? `In ${signals.sharedDomains.join(", ")}` : null,
    signals.sharedSources ? `From ${signals.sharedSources} shared source(s)` : null,
    typeof signals.closeness === "number" ? `${Math.round(signals.closeness * 100)}% similar to the article's knowledge` : null,
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <Tooltip content={<span className="flex flex-col">{lines.map((line) => <span key={line}>{line}</span>)}</span>}>
      <span className="cursor-help text-panel text-faint underline decoration-dotted underline-offset-2">Why grouped</span>
    </Tooltip>
  );
}

function SuggestionCard({ suggestion, units, pages }: { suggestion: Suggestion; units: ReadonlyMap<string, UnitSummary>; pages: ReadonlyMap<string, Tables<"pages">> }) {
  const accept = useServerAction(acceptArticleSuggestion, { progress: false, refreshTables: REFRESH });
  const dismiss = useServerAction(dismissArticleSuggestion, { progress: false, refreshTables: REFRESH });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(suggestion.title);
  const sections = suggestion.sections as unknown as Section[];
  const signals = (suggestion.signals ?? {}) as Signals;
  const target = suggestion.page_id ? pages.get(suggestion.page_id) : undefined;
  const result = suggestion.result_page_id ? pages.get(suggestion.result_page_id) : undefined;
  const busy = suggestion.status === "accepting" || accept.isPending || dismiss.isPending;
  const canAccept = suggestion.status === "pending" || suggestion.status === "failed";
  const merge = suggestion.kind === "merge";
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={merge ? "outline" : "secondary"}>{merge ? "Merge into" : "New article"}</Badge>
            {merge ? (target ? <TextLink href={`/p/${target.slug}`} className="font-medium">{target.title}</TextLink> : <span className="font-medium">{suggestion.title}</span>)
              : editing ? <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} aria-label="Article title" className="h-7 w-72" />
              : <span className="font-medium">{title}</span>}
            {!merge && suggestion.article_type ? <span className="text-panel text-faint">{statusLabel(suggestion.article_type)}</span> : null}
          </div>
          {suggestion.scope ? <p className="text-panel text-muted-foreground">{suggestion.scope}</p> : null}
          {suggestion.rationale ? <p className="text-panel text-faint">{suggestion.rationale}</p> : null}
          {signals.similarTitle ? <Note>Close to the existing article “{signals.similarTitle.title}”: check it isn’t a duplicate.</Note> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {suggestion.status === "accepting" ? <StatusDot tone="muted" busy label="Applying…" /> : null}
          {!merge && canAccept && !editing ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>Edit title</Button> : null}
          {canAccept ? <Button variant="accent" size="sm" disabled={busy || !title.trim()} onClick={() => accept.run(suggestion.id, !merge && title.trim() !== suggestion.title ? title.trim() : undefined)}>
            {suggestion.status === "failed" ? "Retry" : merge ? "Merge" : "Create"}
          </Button> : null}
          {suggestion.status !== "accepting" ? <Button variant="outline" size="sm" disabled={busy} onClick={() => dismiss.run(suggestion.id)}>Dismiss</Button> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-expanded={open} className="text-panel text-link hover:underline" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide sections" : `${sections.length} section(s) · ${suggestion.unit_ids.length} unit(s)`}
        </button>
        <WhyGrouped signals={signals} />
        {result ? <TextLink href={`/p/${result.slug}`}>Open article</TextLink> : null}
      </div>
      {suggestion.status === "failed" ? <ErrorNote error={suggestion.note} /> : suggestion.note ? <Note>{suggestion.note}</Note> : null}
      <ErrorNote error={accept.error ?? dismiss.error} />
      {open ? (
        <ol className="flex flex-col gap-2 border-l pl-3">
          {sections.map((section) => (
            <li key={section.title} className="flex flex-col gap-1">
              <span className="text-panel font-medium">{section.title}{section.sectionId ? <span className="ml-2 font-normal text-faint">existing section</span> : null}</span>
              <ul className="flex flex-col gap-0.5">
                {section.unitIds.map((id) => {
                  const unit = units.get(id);
                  return <li key={id}><TextLink href={`/units/${id}`} className="whitespace-normal text-panel">{unit ? unit.label ?? unit.content : "Retired or unavailable knowledge"}</TextLink></li>;
                })}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

// SUGGESTIONS TAB: run the grouping and AI step, then answer each suggestion
export function SuggestionsTab() {
  useRealtimeInvalidation("suggestion_runs");
  useRealtimeInvalidation("article_suggestions");
  const { filters, setFilter } = useUnitFilters();
  const runs = useSuggestionRuns();
  const suggestions = useArticleSuggestions();
  const units = useUnitSummaries();
  const sectionKnowledge = useSectionKnowledge();
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const pages = usePages();
  const run = useServerAction(runArticleSuggestions, { progress: false, refreshTables: REFRESH });
  const latest = runs.data?.[0];
  const active = latest?.state === "queued" || latest?.state === "running";
  const unitById = useMemo(() => new Map((units.data ?? []).map((unit) => [unit.id, unit])), [units.data]);
  const pageById = useMemo(() => new Map((pages.data ?? []).map((page) => [page.id, page])), [pages.data]);
  const open = useMemo(() => (suggestions.data ?? []).filter((item) => OPEN.has(item.status)), [suggestions.data]);
  const applied = useMemo(() => (suggestions.data ?? []).filter((item) => item.status === "applied").slice(0, 10), [suggestions.data]);
  const unused = useMemo(() => unusedUnits(units.data ?? [], sectionKnowledge.data ?? [], filters.domain, domains.data ?? [], unitDomains.data ?? []),
    [units.data, sectionKnowledge.data, filters.domain, domains.data, unitDomains.data]);
  const held = useMemo(() => new Set(open.flatMap((item) => item.unit_ids)), [open]);
  const free = unused.filter((unit) => !held.has(unit.id)).length;
  const countsReady = units.isSuccess && sectionKnowledge.isSuccess;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="font-mono text-panel">{suggestions.isSuccess ? formatCount(open.length) : "—"}</p>
          <InfoPopover label="About suggestions">
            <PopoverDescription>
              A run groups knowledge no article cites by meaning, links, shared entities, domains and sources, then asks the AI to name a new article with its sections or to merge each group into an existing article. Nothing changes until you accept a suggestion; accepted ones go through Changes and can be undone. The Curator leaves knowledge in an open suggestion alone.
            </PopoverDescription>
          </InfoPopover>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DomainTreeSelect label="Domain" value={filters.domain} domains={domains.data ?? []} emptyLabel="Any domain" onChange={(value) => setFilter("domain", value)} />
          <Tooltip content={countsReady ? `${formatCount(free)} unused unit(s) to group · at most ${MAX_AI_CALLS} AI calls` : "Counting unused knowledge…"}>
            <span>
              <Button variant="accent" size="sm" disabled={active || run.isPending || (countsReady && !free)} onClick={() => run.run(filters.domain || null)}>
                {active ? "Running…" : "Run suggestions"}
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>
      <QueryState query={runs}><RunStatus run={latest} /></QueryState>
      <ErrorNote error={run.error} />
      <QueryState query={suggestions}>
        {open.length ? (
          <ul className="flex flex-col gap-3">
            {open.map((item) => <SuggestionCard key={`${item.id}:${item.title}`} suggestion={item} units={unitById} pages={pageById} />)}
          </ul>
        ) : (
          <EmptyState icon={PageIcon} title="No open suggestions" hint={active ? "Suggestions appear here as each group is done." : "Run suggestions to group unused knowledge into articles."} />
        )}
      </QueryState>
      {countsReady && free ? (
        <Note>{formatCount(free)} unused unit(s) are in no suggestion. <TextLink href="/units?view=unused">See unused knowledge</TextLink></Note>
      ) : null}
      {applied.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-panel font-medium">Recently applied</p>
          <ul className="flex flex-col gap-0.5">
            {applied.map((item) => {
              const page = item.result_page_id ? pageById.get(item.result_page_id) : undefined;
              return (
                <li key={item.id} className="text-panel">
                  {item.kind === "merge" ? "Merged into " : "Created "}
                  {page ? <TextLink href={`/p/${page.slug}`}>{page.title}</TextLink> : item.title}
                  {item.note ? <span className="ml-2 text-faint">{item.note}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
