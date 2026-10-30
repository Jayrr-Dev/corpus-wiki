"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ErrorNote, Note, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { formatCount } from "@/app/(app)/_lib/format";
import { useServerAction } from "@/components/actions/useServerAction";
import { useActiveSpace } from "@/components/shell/SpaceProvider";
import { useIsAdminMode } from "@/components/shell/useNavMode";
import { InfoHint } from "@/components/standard/info-hint";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/lib/database/types";
import { queryKeys, useArticleSuggestions, usePages, useSuggestionRuns } from "@/lib/queries";
import {
  acceptAllArticleSuggestions,
  acceptArticleSuggestion,
  cancelArticleSuggestion,
  dismissArticleSuggestion,
  readNewKnowledge,
  runArticleSuggestions,
} from "@/lib/server-actions/suggestions";
import { isWritingSuggestion, newestWaiting, shouldPrompt, suggestionStage } from "@/lib/suggestions/newKnowledge";

const REFRESH = ["article_suggestions", "suggestion_runs"] as const;
const SEEN_KEY = "wiki-updates-seen";
const BUSY_REFRESH_MS = 4_000;
const IDLE_REFRESH_MS = 60_000;

type Suggestion = Tables<"article_suggestions">;
type Run = Tables<"suggestion_runs">;

function readSeen(spaceId: string): string | null {
  try { return localStorage.getItem(`${SEEN_KEY}:${spaceId}`); } catch { return null; }
}

function saveSeen(spaceId: string, value: string) {
  try { localStorage.setItem(`${SEEN_KEY}:${spaceId}`, value); } catch { /* storage may be disabled */ }
}

const claims = (count: number) => (count === 1 ? "1 claim" : `${formatCount(count)} claims`);

// UPDATES (/pages): the button beside New page and the dialog it opens. The dialog also opens
// by itself once when something newer than the person last closed is waiting.
export function WikiUpdatesDialog() {
  const isAdmin = useIsAdminMode();
  return isAdmin ? <WikiUpdates /> : null;
}

function WikiUpdates() {
  const space = useActiveSpace();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const knowledge = useQuery({
    queryKey: [...queryKeys.table("article_suggestions"), "new-knowledge", space.id],
    queryFn: async () => {
      const result = await readNewKnowledge();
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    retry: false,
  });
  const suggestions = useArticleSuggestions();
  const runs = useSuggestionRuns();
  const latestRun = runs.data?.[0];
  const running = latestRun?.state === "queued" || latestRun?.state === "running";
  const inProgress = useMemo(() => (suggestions.data ?? []).filter((item) => suggestionStage(item) === "in_progress"), [suggestions.data]);
  const pending = useMemo(() => (suggestions.data ?? []).filter((item) => suggestionStage(item) === "pending"), [suggestions.data]);
  const notStarted = knowledge.data?.notStarted ?? 0;
  const uploading = knowledge.data?.uploading ?? 0;
  const busy = running || inProgress.length > 0;
  const newest = newestWaiting(knowledge.data?.newestAt ?? null, pending);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      for (const table of REFRESH) void queryClient.invalidateQueries({ queryKey: queryKeys.table(table) });
    };
    const timer = setInterval(refresh, busy ? BUSY_REFRESH_MS : IDLE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [busy, queryClient]);

  // Applied suggestions change the articles this page lists
  const wasWorking = useRef(false);
  useEffect(() => {
    if (inProgress.length) wasWorking.current = true;
    else if (wasWorking.current) {
      wasWorking.current = false;
      void queryClient.invalidateQueries({ queryKey: queryKeys.table("pages") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.table("sections") });
    }
  }, [inProgress.length, queryClient]);

  // Checked once per visit, so the dialog never jumps up over a page being read
  const [prompted, setPrompted] = useState<string | null>(null);
  if (prompted !== space.id && knowledge.data && suggestions.data) {
    setPrompted(space.id);
    if (shouldPrompt(newest, readSeen(space.id), uploading)) setOpen(true);
  }

  const change = (next: boolean) => {
    if (!next && newest) saveSeen(space.id, newest);
    setOpen(next);
  };
  const attention = notStarted > 0 || pending.length > 0 || inProgress.length > 0;
  const hint = knowledge.data
    ? `${formatCount(inProgress.length)} in progress, ${formatCount(pending.length)} pending, ${claims(notStarted)} not started`
    : "Checking for new knowledge…";
  return (
    <Dialog open={open} onOpenChange={change}>
      <Tooltip content={hint}>
        <span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Updates
            {attention ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
          </Button>
        </span>
      </Tooltip>
      <DialogContent className="sm:max-w-2xl">
        {open ? (
          <UpdatesBody
            inProgress={inProgress}
            pending={pending}
            notStarted={notStarted}
            uploading={uploading}
            run={latestRun}
            running={running}
            loadError={knowledge.error?.message ?? null}
            close={() => change(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UpdatesBody({ inProgress, pending, notStarted, uploading, run, running, loadError, close }: {
  inProgress: Suggestion[];
  pending: Suggestion[];
  notStarted: number;
  uploading: number;
  run: Run | undefined;
  running: boolean;
  loadError: string | null;
  close: () => void;
}) {
  const pages = usePages();
  const pageTitle = useMemo(() => new Map((pages.data ?? []).map((page) => [page.id, page])), [pages.data]);
  const find = useServerAction(runArticleSuggestions, { progress: false, refreshTables: REFRESH });
  const applyAll = useServerAction(acceptAllArticleSuggestions, { progress: false, refreshTables: REFRESH });
  const waiting = pending.filter((item) => item.status === "pending");
  const hasNews = notStarted > 0 || pending.length > 0;
  const inProgressCount = inProgress.length + (running ? 1 : 0) + (uploading ? 1 : 0);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{hasNews ? "New knowledge came in" : "Wiki updates"}</DialogTitle>
        <DialogDescription>{hasNews ? "Update the wiki with it?" : "Nothing is waiting on you."}</DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto">
        <Group title="In progress" count={inProgressCount}>
          {uploading ? <li><StatusDot tone="muted" busy label={uploading === 1 ? "Reading 1 upload…" : `Reading ${formatCount(uploading)} uploads…`} /></li> : null}
          {running && run ? <li><StatusDot tone="muted" busy label={runLabel(run)} /></li> : null}
          {inProgress.map((item) => <WorkingRow key={item.id} item={item} page={targetOf(item, pageTitle)} />)}
        </Group>
        <Group
          title="Pending"
          count={pending.length}
          action={waiting.length > 1 ? (
            <Button size="sm" variant="outline" disabled={applyAll.isPending} onClick={() => applyAll.run(waiting.map((item) => item.id))}>
              {applyAll.isPending ? "Starting…" : "Apply all"}
            </Button>
          ) : null}
        >
          {pending.map((item) => <PendingRow key={item.id} item={item} page={targetOf(item, pageTitle)} />)}
        </Group>
        <Group
          title="Not started"
          count={notStarted}
          action={notStarted ? (
            <Button size="sm" variant="accent" disabled={running || find.isPending} onClick={() => find.run(null)}>
              {running ? "Finding…" : "Find updates"}
            </Button>
          ) : null}
        >
          {notStarted ? (
            <li className="text-panel">
              {claims(notStarted)} not in the wiki yet. <TextLink href="/units?view=unused">See them</TextLink>
            </li>
          ) : null}
        </Group>
        <LastRun run={run} running={running} />
        <ErrorNote error={loadError ?? find.error ?? applyAll.error} />
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <TextLink href="/units?view=suggestions">All suggestions</TextLink>
        <Button variant="outline" onClick={close}>{hasNews ? "Not now" : "Close"}</Button>
      </DialogFooter>
    </>
  );
}

function Group({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-panel font-medium">{title} <span className="font-normal text-faint">{formatCount(count)}</span></h3>
        {action}
      </div>
      {count ? <ul className="flex flex-col gap-2">{children}</ul> : <p className="text-panel text-muted-foreground">None.</p>}
    </section>
  );
}

function runLabel(run: Run) {
  if (run.state === "queued") return "Starting…";
  if (run.phase === "grouping" || !run.total) return "Grouping new knowledge…";
  return `Checking group ${formatCount(Math.min(run.done + 1, run.total))} of ${formatCount(run.total)}…`;
}

function LastRun({ run, running }: { run: Run | undefined; running: boolean }) {
  if (!run || running) return null;
  if (run.state === "failed") return <ErrorNote error={`The last check failed: ${run.error ?? "unknown error"}`} />;
  if (run.error) return <ErrorNote error={run.error} />;
  return !run.suggested ? <Note>The last check found nothing to suggest.</Note> : null;
}

type TargetPage = Pick<Tables<"pages">, "title" | "slug">;

function targetOf(item: Suggestion, pages: ReadonlyMap<string, TargetPage>) {
  const id = item.kind === "merge" ? item.page_id : item.result_page_id;
  return id ? pages.get(id) : undefined;
}

// What the suggestion does: its article, and new article or update
function SuggestionTitle({ item, page }: { item: Suggestion; page: TargetPage | undefined }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-1.5 font-medium">
        {page ? <TextLink href={`/p/${page.slug}`} className="whitespace-normal">{page.title}</TextLink> : <span>{item.title}</span>}
        {item.rationale ? <InfoHint>{item.rationale}</InfoHint> : null}
      </p>
      <p className="text-panel text-faint">{item.kind === "merge" ? "Update article" : "New article"}, {claims(item.unit_ids.length)}</p>
    </div>
  );
}

function PendingRow({ item, page }: { item: Suggestion; page: TargetPage | undefined }) {
  const accept = useServerAction(acceptArticleSuggestion, { progress: false, refreshTables: REFRESH });
  const dismiss = useServerAction(dismissArticleSuggestion, { progress: false, refreshTables: REFRESH });
  const disabled = accept.isPending || dismiss.isPending;
  const canAccept = item.status !== "stale";
  const label = item.status === "failed" ? "Retry" : item.kind === "merge" ? "Update" : "Create";
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start gap-3">
        <SuggestionTitle item={item} page={page} />
        <div className="flex shrink-0 items-center gap-2">
          {canAccept ? <Button size="sm" variant="accent" disabled={disabled} onClick={() => accept.run(item.id)}>{label}</Button> : null}
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => dismiss.run(item.id)}>Dismiss</Button>
        </div>
      </div>
      {item.status === "failed" ? <ErrorNote error={item.note} /> : item.note ? <Note>{item.note}</Note> : null}
      <ErrorNote error={accept.error ?? dismiss.error} />
    </li>
  );
}

function WorkingRow({ item, page }: { item: Suggestion; page: TargetPage | undefined }) {
  const cancel = useServerAction(cancelArticleSuggestion, { progress: false, refreshTables: REFRESH });
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start gap-3">
        <SuggestionTitle item={item} page={page} />
        <StatusDot tone="muted" busy label={isWritingSuggestion(item) ? "Writing…" : "Applying…"} />
        {item.status === "accepting" ? (
          <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.run(item.id)}>
            {cancel.isPending ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null}
      </div>
      {item.note?.trim() ? <p className="mt-2 text-panel text-muted-foreground">{item.note}</p> : null}
      <ErrorNote error={cancel.error} />
    </li>
  );
}
