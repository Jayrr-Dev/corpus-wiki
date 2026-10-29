"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ErrorNote, Note } from "@/app/(app)/_components/bits";
import type { StudySetRow, StudySetsData } from "@/lib/study/types";
import { Practice } from "../Practice";
import { rebuildStale } from "../studyApi";
import { ProgressPanel } from "./ProgressPanel";
import { QuestionsPanel } from "./QuestionsPanel";

const TABS = [{ id: "practice", label: "Practice" }, { id: "progress", label: "Progress" }, { id: "questions", label: "Questions" }] as const;
type TabId = (typeof TABS)[number]["id"];

// TABS: Practice · Progress · Questions (arrow keys move between them)
function Tabs({ active, onSelect, panels }: { active: TabId; onSelect: (id: TabId) => void; panels: Record<TabId, ReactNode> }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((tab) => tab.id === active) + step + TABS.length) % TABS.length]!;
    onSelect(next.id);
    document.getElementById(`study-${next.id}-tab`)?.focus();
  };
  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Study set" onKeyDown={onKeyDown} className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button key={tab.id} id={`study-${tab.id}-tab`} type="button" role="tab" aria-selected={tab.id === active} aria-controls={`study-${tab.id}-panel`} tabIndex={tab.id === active ? 0 : -1} onClick={() => onSelect(tab.id)}
            className={`border-b-2 px-3 py-2.5 text-panel transition-colors ${tab.id === active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tab.label}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted, so a practice session survives a look at Progress */}
      {TABS.map((tab) => (
        <div key={tab.id} role="tabpanel" id={`study-${tab.id}-panel`} aria-labelledby={`study-${tab.id}-tab`} hidden={tab.id !== active}>{panels[tab.id]}</div>
      ))}
    </div>
  );
}

// The source's video a set opens with; playUrl is set once it is ready
export type IntroVideo = { id: string; title: string; ready: boolean; playUrl: string | null; posterUrl: string | null };

// INTRO VIDEO: the player, or a line while it is made or when the source has none
function Intro({ video }: { video: IntroVideo | null }) {
  if (!video) return <Note>No video for this source yet. <Link href="/video" className="underline">Make one</Link></Note>;
  if (!video.ready || !video.playUrl) return <Note>The video is being made. <Link href={`/video/${video.id}`} className="underline">Follow it</Link></Note>;
  return <video controls preload="metadata" poster={video.posterUrl ?? undefined} src={video.playUrl} aria-label={video.title} className="aspect-video w-full rounded-xl bg-black" />;
}

// ONE SET: rebuilds questions whose claim changed as it opens, then the intro video (if asked for) and the three tabs.
// `intro` is undefined when the set has no intro video, null when its source has none yet
export function StudySetView({ set, data, intro }: { set: StudySetRow; data: StudySetsData; intro?: IntroVideo | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("practice");
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stale = data.items.filter((item) => item.stale && !data.claims.find((claim) => claim.unitId === item.unitId)?.retired).length;
  const started = useRef(false);

  useEffect(() => {
    if (!stale || started.current) return;
    started.current = true;
    setRebuilding(true);
    rebuildStale(set.id)
      .then(() => router.refresh())
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setRebuilding(false));
  }, [stale, set.id, router]);

  const items = data.items.filter((item) => item.setId === set.id);
  return (
    <div className="grid gap-3">
      {rebuilding ? <Note>Sources changed. Rewriting {stale} question{stale === 1 ? "" : "s"}…</Note> : null}
      <ErrorNote error={error} />
      {intro !== undefined ? <Intro video={intro} /> : null}
      <Tabs active={tab} onSelect={setTab} panels={{
        practice: <Practice items={items} claims={data.claims} progress={data.progress} />,
        progress: <ProgressPanel set={set} data={data} />,
        questions: <QuestionsPanel setId={set.id} items={items} claims={data.claims} />,
      }} />
    </div>
  );
}
