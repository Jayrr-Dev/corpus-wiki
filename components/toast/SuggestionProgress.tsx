"use client";

import { useActiveSpace } from "@/components/shell/SpaceProvider";
import { useArticleSuggestions, useSuggestionRuns } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime/useRealtimeInvalidation";
import { useEffect } from "react";
import { startProgress, type ProgressHandle } from "./ProgressToast";
import { nextSuggestionToast, suggestionWriting, type RunSnapshot, type SuggestionSnapshot } from "./suggestionToast";

type Session = {
  progress: ProgressHandle | null;
  batch: Set<string>;
  watchingRun: boolean;
};

// One card for the whole app. A remount must update that card, not open a second one.
let sessionSpace = "";
let session: Session = { progress: null, batch: new Set(), watchingRun: false };

function sessionFor(spaceId: string) {
  if (sessionSpace === spaceId) return session;
  session.progress?.fail();
  sessionSpace = spaceId;
  session = { progress: null, batch: new Set(), watchingRun: false };
  return session;
}

// Bottom toast while suggestions are found or applied. It stays up to date
// after you leave the Suggestions tab. Hiding it does not stop the work.
export function SuggestionProgress() {
  const space = useActiveSpace();
  useRealtimeInvalidation("article_suggestions");
  useRealtimeInvalidation("suggestion_runs");
  const suggestions = useArticleSuggestions();
  const runs = useSuggestionRuns();
  const refetchSuggestions = suggestions.refetch;
  const refetchRuns = runs.refetch;

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refetchSuggestions();
      void refetchRuns();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refetchSuggestions, refetchRuns]);

  useEffect(() => {
    const current = sessionFor(space.id);
    const items: SuggestionSnapshot[] = (suggestions.data ?? []).map((item) => ({
      id: item.id,
      kind: item.kind === "merge" ? "merge" : "create",
      status: item.status,
      title: item.title,
      note: item.note,
      writing: suggestionWriting(item.status, item.signals),
    }));
    const latest = runs.data?.[0];
    const run: RunSnapshot | null = latest
      ? { state: latest.state, phase: latest.phase, done: latest.done, total: latest.total, suggested: latest.suggested, error: latest.error }
      : null;
    const next = nextSuggestionToast(items, current.batch, run, current.watchingRun);
    current.batch = next.batch;
    current.watchingRun = next.watchingRun;
    const toast = next.toast;
    if (!toast) return;
    if (!current.progress) current.progress = startProgress(toast.title, toast.detail);
    if (toast.done) {
      current.progress.done(toast.detail);
      current.progress = null;
      return;
    }
    current.progress.update(toast.detail, toast.fraction, toast.title);
  }, [space.id, suggestions.data, runs.data]);

  return null;
}
