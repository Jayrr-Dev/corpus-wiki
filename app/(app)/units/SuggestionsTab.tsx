"use client";

import {
  ErrorNote,
  Note,
  QueryState,
  TextLink,
} from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import {
  formatCount,
  formatDateTime,
  statusLabel,
} from "@/app/(app)/_lib/format";
import { DomainTreeSelect } from "@/components/actions/DomainTreeSelect";
import { useServerAction } from "@/components/actions/useServerAction";
import { EmptyState } from "@/components/EmptyState";
import { PageIcon } from "@/components/icons";
import { InfoPopover } from "@/components/standard/info-popover";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { PopoverDescription } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/database/types";
import {
  queryKeys,
  useArticleSuggestions,
  useDomains,
  usePages,
  useSuggestionRuns,
  useUnitDomains,
} from "@/lib/queries";
import {
  type UnitSummary,
  useSectionKnowledge,
} from "@/lib/queries/screens";
import { useRealtimeInvalidation } from "@/lib/realtime/useRealtimeInvalidation";
import {
  acceptAllArticleSuggestions,
  acceptArticleSuggestion,
  cancelArticleSuggestion,
  dismissArticleSuggestion,
  runArticleSuggestions,
} from "@/lib/server-actions/suggestions";
import { isWritingSuggestion as isWriting } from "@/lib/suggestions/newKnowledge";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, CircleAlert, LoaderCircle } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAllUnitSummaries } from "./unitSummaries";
import { unusedUnits } from "./UnusedUnits";
import { useUnitFilters } from "./useUnitFilters";

const OPEN = new Set(["pending", "accepting", "failed", "stale"]);
const REFRESH = ["article_suggestions", "suggestion_runs"] as const;

type Suggestion = Tables<"article_suggestions">;
type Run = Tables<"suggestion_runs">;
type Section = { title: string; sectionId: string | null; unitIds: string[] };
type Signals = {
  cohesion?: number;
  links?: number;
  sharedEntities?: string[];
  sharedDomains?: string[];
  sharedSources?: number;
  closeness?: number | null;
  similarTitle?: { pageId: string; title: string } | null;
  writing?: boolean;
  progress?: {
    doneTitles?: string[];
    doneIds?: string[];
    currentTitle?: string | null;
    currentId?: string | null;
  };
};

type MarkState = "done" | "working" | "stuck" | "todo";
// Where each claim sits on a live article: page and section title
type Placements = ReadonlyMap<string, { pageId: string; title: string }[]>;

const MARK_ICON: Record<MarkState, ReactNode> = {
  done: <Check className="size-3.5 text-applied" />,
  working: <LoaderCircle className="size-3.5 animate-spin" />,
  stuck: <CircleAlert className="size-3.5 text-destructive" />,
  todo: <Circle className="size-3.5 text-faint" />,
};

function reasonPoints(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => {
      const count = sentence.split(/\s+/).filter(Boolean).length;
      if (count <= 16) return sentence;
      const clause = sentence.split(",")[0]?.trim() ?? sentence;
      return clause.endsWith(".") ? clause : `${clause}.`;
    });
}

function isOpen(item: Suggestion) {
  return OPEN.has(item.status) || isWriting(item);
}

function Mark({ state, hint }: { state: MarkState; hint: string }) {
  return (
    <Tooltip content={hint}>
      <span
        className="mt-0.5 inline-flex shrink-0 text-muted-foreground"
        aria-label={hint}
      >
        {MARK_ICON[state]}
      </span>
    </Tooltip>
  );
}

function PlacedBar({ placed, total }: { placed: number; total: number }) {
  const percent = total ? Math.round((placed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={placed}
        aria-label="Claims placed on the article"
      >
        <div
          className="h-full w-(--progress) rounded-full bg-applied transition-all duration-300"
          style={{ "--progress": `${percent}%` } as CSSProperties}
        />
      </div>
      <span className="text-panel text-muted-foreground">
        {formatCount(placed)} of {formatCount(total)} claims placed
      </span>
    </div>
  );
}

// RUN STATUS: what the newest run is doing, or how the last one ended
function RunStatus({ run }: { run: Run | undefined }) {
  if (!run) return <Note>No suggestions have been run yet.</Note>;
  if (run.state === "queued")
    return <StatusDot tone="muted" busy label="Starting…" />;
  if (run.state === "running") {
    const label =
      run.phase === "grouping" || !run.total
        ? "Grouping related knowledge…"
        : `Asking the AI about group ${Math.min(run.done + 1, run.total)} of ${run.total}…`;
    return (
      <span className="flex flex-col gap-1">
        <StatusDot tone="muted" busy label={label} />
        {run.error ? <Note>Retrying after: {run.error}</Note> : null}
      </span>
    );
  }
  if (run.state === "failed")
    return (
      <ErrorNote
        error={`The last run failed: ${run.error ?? "unknown error"}`}
      />
    );
  return (
    <span className="flex flex-col gap-1">
      <Note>
        Last run {formatDateTime(run.finished_at)}: {formatCount(run.total)}{" "}
        group(s), {formatCount(run.suggested)} suggestion(s).
      </Note>
      {run.error ? <ErrorNote error={run.error} /> : null}
    </span>
  );
}

function WhyGrouped({ signals }: { signals: Signals }) {
  const lines = [
    signals.cohesion !== undefined
      ? `Average similarity ${Math.round(signals.cohesion * 100)}%`
      : null,
    signals.links ? `${signals.links} link(s) between these units` : null,
    signals.sharedEntities?.length
      ? `About ${signals.sharedEntities.join(", ")}`
      : null,
    signals.sharedDomains?.length
      ? `In ${signals.sharedDomains.join(", ")}`
      : null,
    signals.sharedSources
      ? `From ${signals.sharedSources} shared source(s)`
      : null,
    typeof signals.closeness === "number"
      ? `${Math.round(signals.closeness * 100)}% similar to the article's knowledge`
      : null,
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <InfoPopover label="Why grouped">
      <PopoverDescription>Why these claims were grouped.</PopoverDescription>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </InfoPopover>
  );
}

function SuggestionCard({
  suggestion,
  units,
  pages,
  placements,
}: {
  suggestion: Suggestion;
  units: ReadonlyMap<string, UnitSummary>;
  pages: ReadonlyMap<string, Tables<"pages">>;
  placements: Placements;
}) {
  const accept = useServerAction(acceptArticleSuggestion, {
    progress: false,
    refreshTables: REFRESH,
  });
  const cancel = useServerAction(cancelArticleSuggestion, {
    progress: false,
    refreshTables: REFRESH,
  });
  const dismiss = useServerAction(dismissArticleSuggestion, {
    progress: false,
    refreshTables: REFRESH,
  });
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [title, setTitle] = useState(suggestion.title);
  const sections = suggestion.sections as unknown as Section[];
  const signals = (suggestion.signals ?? {}) as Signals;
  const doneTitles = new Set(signals.progress?.doneTitles ?? []);
  const doneIds = new Set(signals.progress?.doneIds ?? []);
  const stuck =
    /failed|could not be fully undone|still being written|has no text/i.test(
      suggestion.note ?? "",
    );
  const tracking = ["accepting", "failed", "applied"].includes(
    suggestion.status,
  );
  const targetPageId =
    suggestion.kind === "merge"
      ? suggestion.page_id
      : suggestion.result_page_id;
  const placedIn = (unitId: string) =>
    (placements.get(unitId) ?? []).find(
      (place) => place.pageId === targetPageId,
    );
  const placedCount = suggestion.unit_ids.filter((id) => placedIn(id)).length;
  const writing = isWriting(suggestion);
  const working = suggestion.status === "accepting" || writing;
  const sectionMark = (section: Section): MarkState => {
    // A new article places every claim up front, so placement can't show writing progress
    if (!writing && section.unitIds.every((id) => placedIn(id))) return "done";
    if (
      doneTitles.has(section.title) ||
      (section.sectionId && doneIds.has(section.sectionId))
    )
      return "done";
    const current =
      signals.progress?.currentTitle === section.title ||
      (section.sectionId && signals.progress?.currentId === section.sectionId);
    if (current) return stuck ? "stuck" : "working";
    return "todo";
  };
  const SECTION_HINT: Record<MarkState, string> = {
    done: "Every claim in this section is placed",
    working: "Being written now",
    stuck: "The apply stopped here",
    todo: "Not done yet",
  };
  const target = suggestion.page_id ? pages.get(suggestion.page_id) : undefined;
  const result = suggestion.result_page_id
    ? pages.get(suggestion.result_page_id)
    : undefined;
  const busy =
    suggestion.status === "accepting" || accept.isPending || dismiss.isPending;
  const canAccept =
    suggestion.status === "pending" || suggestion.status === "failed";
  const merge = suggestion.kind === "merge";
  const heading = merge ? (target?.title ?? suggestion.title) : title;
  const claimCount = suggestion.unit_ids.length;
  const sectionList = (
    <ol className="flex max-h-48 flex-col gap-2 overflow-y-auto">
      {sections.map((section) => {
        const mark = sectionMark(section);
        return (
          <li key={section.title} className="flex flex-col gap-1">
            <span className="flex items-start gap-1.5 font-medium">
              {tracking ? (
                <Mark state={mark} hint={SECTION_HINT[mark]} />
              ) : null}
              <span>
                {section.title}
                {section.sectionId ? (
                  <span className="ml-2 font-normal text-faint">
                    Existing section
                  </span>
                ) : null}
              </span>
            </span>
            <ul className="flex flex-col gap-0.5">
              {section.unitIds.map((id) => {
                const unit = units.get(id);
                const place = placedIn(id);
                return (
                  <li key={id} className="flex items-start gap-1.5">
                    {tracking ? (
                      <Mark
                        state={place ? "done" : "todo"}
                        hint={
                          place
                            ? `Placed in “${place.title}”`
                            : "Not placed on the article yet"
                        }
                      />
                    ) : null}
                    <TextLink
                      href={`/units/${id}`}
                      className="whitespace-normal"
                    >
                      {unit
                        ? (unit.label ?? unit.content)
                        : "Retired or unavailable knowledge"}
                    </TextLink>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
  const claimLabel =
    claimCount === 1 ? "1 claim" : `${formatCount(claimCount)} claims`;
  const destination = merge ? "Existing article" : suggestion.article_type ? statusLabel(suggestion.article_type) : "New article";
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-faint uppercase">
            Recommended action
            <WhyGrouped signals={signals} />
          </div>
          <p className="mt-1 font-medium">{merge ? "Merge" : "New article"}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {working ? (
            <StatusDot
              tone="muted"
              busy
              label={writing ? "Writing…" : "Applying…"}
            />
          ) : null}
          {suggestion.status === "accepting" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.run(suggestion.id)}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
          {!merge && canAccept && !editing ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit title
            </Button>
          ) : null}
          {canAccept ? (
            <Button
              variant="accent"
              size="sm"
              disabled={busy || !title.trim()}
              onClick={() =>
                accept.run(
                  suggestion.id,
                  !merge && title.trim() !== suggestion.title
                    ? title.trim()
                    : undefined,
                )
              }
            >
              {suggestion.status === "failed"
                ? "Retry"
                : merge
                  ? "Merge"
                  : "Create"}
            </Button>
          ) : null}
          {!working ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => dismiss.run(suggestion.id)}
            >
              Dismiss
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <div className="flex min-h-16 flex-1 flex-col items-center justify-center gap-2 rounded-md border px-3 py-3 text-center">
          <p className="font-medium">{claimLabel}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={viewing}
            onClick={() => setViewing((open) => !open)}
          >
            {viewing ? "Hide" : "View"}
          </Button>
        </div>
        <ArrowRight
          className="mx-auto size-4 shrink-0 rotate-90 text-faint sm:mx-0 sm:rotate-0"
          aria-hidden
        />
        <div className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center rounded-md border px-3 py-3 text-center">
          {editing ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={150}
              aria-label="Article title"
              className="h-8 w-full"
            />
          ) : target ? (
            <TextLink href={`/p/${target.slug}`} className="font-medium">
              {heading}
            </TextLink>
          ) : (
            <p className="font-medium">{heading}</p>
          )}
          <p className="max-w-full truncate text-panel text-faint">{destination}</p>
          {result ? (
            <TextLink href={`/p/${result.slug}`}>Open article</TextLink>
          ) : null}
        </div>
      </div>
      {suggestion.rationale ? (
        <>
          <p className="mt-3 text-xs font-medium tracking-wide text-faint uppercase">
            Reason
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {reasonPoints(suggestion.rationale).map((point) => (
              <li key={point} className="text-panel">
                {point}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {viewing ? <div className="mt-3">{sections.length ? sectionList : <p className="text-muted-foreground">No claims are listed.</p>}</div> : null}
      {working ? (
        <p className="mt-3 text-panel text-muted-foreground">
          {suggestion.note?.trim() ||
            "Checking the knowledge still matches this suggestion…"}
        </p>
      ) : null}
      {signals.similarTitle ? (
        <Note>
          Close to the existing article “{signals.similarTitle.title}”: check
          it isn’t a duplicate.
        </Note>
      ) : null}
      {tracking ? (
        <PlacedBar placed={placedCount} total={suggestion.unit_ids.length} />
      ) : null}
      {suggestion.status === "failed" ? (
        <ErrorNote error={suggestion.note} />
      ) : !working && suggestion.note ? (
        <Note>{suggestion.note}</Note>
      ) : null}
      <ErrorNote error={accept.error ?? cancel.error ?? dismiss.error} />
    </li>
  );
}

// SUGGESTIONS TAB: run the grouping and AI step, then answer each suggestion
export function SuggestionsTab() {
  useRealtimeInvalidation("suggestion_runs");
  useRealtimeInvalidation("article_suggestions");
  const queryClient = useQueryClient();
  const { filters, setFilter } = useUnitFilters();
  const runs = useSuggestionRuns();
  const suggestions = useArticleSuggestions();
  const units = useAllUnitSummaries();
  const sectionKnowledge = useSectionKnowledge();
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const pages = usePages();
  const run = useServerAction(runArticleSuggestions, {
    progress: false,
    refreshTables: REFRESH,
  });
  const acceptAll = useServerAction(acceptAllArticleSuggestions, {
    progress: false,
    refreshTables: REFRESH,
  });
  const [kind, setKind] = useState<"merge" | "create" | null>(null);
  const latest = runs.data?.[0];
  const active = latest?.state === "queued" || latest?.state === "running";
  const unitById = useMemo(
    () => new Map((units.data ?? []).map((unit) => [unit.id, unit])),
    [units.data],
  );
  const pageById = useMemo(
    () => new Map((pages.data ?? []).map((page) => [page.id, page])),
    [pages.data],
  );
  const placements = useMemo(() => {
    const map = new Map<string, { pageId: string; title: string }[]>();
    for (const section of sectionKnowledge.data ?? [])
      for (const unit of section.units)
        map.set(unit.id, [
          ...(map.get(unit.id) ?? []),
          { pageId: section.pageId, title: section.title },
        ]);
    return map;
  }, [sectionKnowledge.data]);
  const open = useMemo(
    () => (suggestions.data ?? []).filter(isOpen),
    [suggestions.data],
  );
  const applying = open.some(
    (item) => item.status === "accepting" || isWriting(item),
  );
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.table("suggestion_runs"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.table("article_suggestions"),
      });
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [active, queryClient]);
  const wasApplying = useRef(false);
  useEffect(() => {
    if (applying) {
      wasApplying.current = true;
      const timer = setInterval(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.table("article_suggestions"),
        });
        // Claim checkmarks come from where each claim sits on the article
        void queryClient.invalidateQueries({
          queryKey: [...queryKeys.table("sections"), "section-knowledge"],
        });
      }, 4000);
      return () => clearInterval(timer);
    }
    if (!wasApplying.current) return;
    wasApplying.current = false;
    // Placed claims leave the unused count only after section knowledge reloads.
    void queryClient.invalidateQueries({
      queryKey: queryKeys.table("sections"),
    });
    void queryClient.invalidateQueries({
      queryKey: [...queryKeys.table("units"), "knowledge-usage"],
    });
  }, [applying, queryClient]);
  const applied = useMemo(
    () =>
      (suggestions.data ?? [])
        .filter((item) => item.status === "applied" && !isWriting(item))
        .slice(0, 10),
    [suggestions.data],
  );
  const unused = useMemo(
    () =>
      unusedUnits(
        units.data ?? [],
        sectionKnowledge.data ?? [],
        filters.domain,
        domains.data ?? [],
        unitDomains.data ?? [],
      ),
    [
      units.data,
      sectionKnowledge.data,
      filters.domain,
      domains.data,
      unitDomains.data,
    ],
  );
  const shown = useMemo(
    () => open.filter((item) => kind === null || item.kind === kind),
    [open, kind],
  );
  const mergeCount = open.filter((item) => item.kind === "merge").length;
  const articleCount = open.filter((item) => item.kind === "create").length;
  const acceptable = useMemo(
    () =>
      shown.filter((item) => item.status === "pending"),
    [shown],
  );
  const held = useMemo(
    () => new Set(open.flatMap((item) => item.unit_ids)),
    [open],
  );
  const free = unused.filter((unit) => !held.has(unit.id)).length;
  const countsReady = units.isSuccess && sectionKnowledge.isSuccess;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="mr-auto flex gap-1" role="group" aria-label="Filter suggestions">
          <Button
            type="button"
            size="sm"
            variant={kind === "merge" ? "accent" : "outline"}
            aria-pressed={kind === "merge"}
            onClick={() => setKind((current) => (current === "merge" ? null : "merge"))}
          >
            Merge {formatCount(mergeCount)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={kind === "create" ? "accent" : "outline"}
            aria-pressed={kind === "create"}
            onClick={() => setKind((current) => (current === "create" ? null : "create"))}
          >
            Articles {formatCount(articleCount)}
          </Button>
        </div>
        <DomainTreeSelect
          label="Domain"
          value={filters.domain}
          domains={domains.data ?? []}
          emptyLabel="Any domain"
          onChange={(value) => setFilter("domain", value)}
        />
        <Tooltip
          content={
            countsReady
              ? `${formatCount(free)} unused unit(s) to group. Claims already in a suggestion are skipped. Likely merges are suggested first, then whatever is left.`
              : "Counting unused knowledge…"
          }
        >
          <span>
            <Button
              variant="accent"
              size="sm"
              disabled={active || run.isPending || (countsReady && !free)}
              onClick={() => run.run(filters.domain || null)}
            >
              {active ? "Running…" : "Run suggestions"}
            </Button>
          </span>
        </Tooltip>
        <Tooltip content={kind === null ? "Accept suggestions that are still waiting. Merges go first. Ones already running, finished, or failed stay as they are." : "Accept the waiting suggestions in this filter. Ones already running, finished, or failed stay as they are."}>
          <span>
            <Button
              variant="outline"
              size="sm"
              disabled={!acceptable.length || acceptAll.isPending}
              onClick={() => acceptAll.run(kind === null ? undefined : acceptable.map((item) => item.id))}
            >
              {acceptAll.isPending ? "Starting…" : "Apply all"}
            </Button>
          </span>
        </Tooltip>
      </div>
      <QueryState query={runs}>
        <RunStatus run={latest} />
      </QueryState>
      <ErrorNote error={run.error ?? acceptAll.error} />
      <QueryState query={suggestions}>
        {shown.length ? (
          <ul className="flex flex-col gap-3">
            {shown.map((item) => (
              <SuggestionCard
                key={`${item.id}:${item.title}`}
                suggestion={item}
                units={unitById}
                pages={pageById}
                placements={placements}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={PageIcon}
            title={kind === "merge" ? "No merge suggestions" : kind === "create" ? "No article suggestions" : "No open suggestions"}
            hint={
              kind !== null
                ? "The other filter may still have suggestions."
                : active
                  ? "Suggestions appear here as each group is done."
                  : "Run suggestions to group unused knowledge into articles."
            }
          />
        )}
      </QueryState>
      {countsReady && free ? (
        <Note>
          {formatCount(free)} unused unit(s) are in no suggestion.{" "}
          <TextLink href="/units?view=unused">See unused knowledge</TextLink>
        </Note>
      ) : null}
      {applied.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-panel font-medium">Recently applied</p>
          <ul className="flex flex-col gap-0.5">
            {applied.map((item) => {
              const page = item.result_page_id
                ? pageById.get(item.result_page_id)
                : undefined;
              return (
                <li key={item.id} className="text-panel">
                  {item.kind === "merge" ? "Merged into " : "Created "}
                  {page ? (
                    <TextLink href={`/p/${page.slug}`}>{page.title}</TextLink>
                  ) : (
                    item.title
                  )}
                  {item.note ? (
                    <span className="ml-2 text-faint">{item.note}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
