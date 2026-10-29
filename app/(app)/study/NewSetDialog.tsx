"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { CoveragePicker } from "@/components/knowledge/CoveragePicker";
import { ScopePicker } from "@/components/knowledge/ScopePicker";
import { InfoHint } from "@/components/standard/info-hint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type CoverageChoice, isCompleteScope, isCustomChoice, type Scope, type ScopeOptions, scopeTitle } from "@/lib/knowledge/scopeTypes";
import { STUDY_KINDS, type StudyKind } from "@/lib/study/types";
import { ensureSourceVideo } from "../video/actions";
import { createSet } from "./studyApi";

// The checkbox labels in the New set form (plural, as the plan words them)
const KIND_CHOICES: Record<StudyKind, string> = { flashcard: "Flashcards", multiple_choice: "Multiple choice", short_answer: "Short answer" };

// A set is named after its source
function setTitle(scope: Scope, options: ScopeOptions): string {
  return scopeTitle(scope, options, "Study set");
}

function FieldLabel({ id, label, hint }: { id?: string; label: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span id={id} className="text-sm font-medium">{label}</span>
      {hint ? <InfoHint>{hint}</InfoHint> : null}
    </div>
  );
}

// NEW SET: source, coverage, question types and the intro video; Create writes the questions with a running count.
// `videoOn`: the Video module is on, so a set can open with its source's video
export function NewSetButton({ options, videoOn }: { options: ScopeOptions; videoOn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [coverage, setCoverage] = useState<CoverageChoice>(100);
  const [types, setTypes] = useState<StudyKind[]>([...STUDY_KINDS]);
  const [introVideo, setIntroVideo] = useState(false);
  const [createMissing, setCreateMissing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a Custom pick belongs to its source: changing the source starts again at 100%
  const chooseScope = (next: Scope | null) => { setScope(next); if (isCustomChoice(coverage)) setCoverage(100); };
  const toggle = (kind: StudyKind, on: boolean) => setTypes((current) => STUDY_KINDS.filter((item) => (item === kind ? on : current.includes(item))));
  const reset = () => { setScope(null); setCoverage(100); setTypes([...STUDY_KINDS]); setIntroVideo(false); setCreateMissing(false); setProgress(null); setError(null); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCompleteScope(scope) || !types.length) return;
    setBuilding(true);
    setError(null);
    setProgress(null);
    try {
      // The video first: a missing render setting stops here, before any questions are written
      if (introVideo && createMissing) {
        const video = await ensureSourceVideo({ scope, coverage });
        if (!video.ok) throw new Error(video.error);
        setProgress({ done: 0, total: 0 });
      }
      const id = await createSet({ title: setTitle(scope, options), scope, coverage, types, introVideo }, (done, total) => setProgress({ done, total }));
      setOpen(false);
      reset();
      router.push(`/study/${id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBuilding(false); }
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>New set</Button>
      <Dialog open={open} onOpenChange={(next) => { if (building) return; setOpen(next); if (!next) reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>New set</DialogTitle>
              <DialogDescription>The Tutor writes questions from the claims in a source.</DialogDescription>
            </DialogHeader>
            <div>
              <FieldLabel label="Source" />
              <ScopePicker options={options} value={scope} onChange={chooseScope} disabled={building} />
            </div>
            <div>
              <FieldLabel label="Coverage" hint="Below 100%, the most-cited claims come first." />
              <CoveragePicker value={coverage} onChange={setCoverage} scope={scope} disabled={building} />
            </div>
            <fieldset aria-labelledby="study-questions-label">
              <FieldLabel id="study-questions-label" label="Questions" hint="Short answers are graded by AI against the source." />
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {STUDY_KINDS.map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-panel">
                    <input type="checkbox" className="accent-link" checked={types.includes(kind)} disabled={building} onChange={(event) => toggle(kind, event.target.checked)} />
                    <span className="font-medium">{KIND_CHOICES[kind]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {videoOn ? (
              <fieldset aria-labelledby="study-video-label">
                <FieldLabel id="study-video-label" label="Video" />
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <label className="flex items-center gap-2 text-panel">
                    <input type="checkbox" className="accent-link" checked={introVideo} disabled={building} onChange={(event) => { setIntroVideo(event.target.checked); if (!event.target.checked) setCreateMissing(false); }} />
                    <span className="font-medium">Start with video</span>
                    <InfoHint>Plays the newest video made from this source before the questions.</InfoHint>
                  </label>
                  <label className="flex items-center gap-2 text-panel">
                    <input type="checkbox" className="accent-link" checked={createMissing} disabled={building || !introVideo} onChange={(event) => setCreateMissing(event.target.checked)} />
                    <span className={`font-medium ${introVideo ? "" : "text-muted-foreground"}`}>Create missing</span>
                    <InfoHint>No video yet? Makes a short one. This costs voice and render time.</InfoHint>
                  </label>
                </div>
              </fieldset>
            ) : null}
            {building ? (
              <p role="status" className="text-panel text-muted-foreground">
                {progress?.total ? `Writing ${progress.total} questions… ${progress.done} / ${progress.total}` : introVideo && createMissing && !progress ? "Checking the video…" : "Writing questions…"}
              </p>
            ) : null}
            <ErrorNote error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={building}>Cancel</Button>
              <Button type="submit" disabled={building || !isCompleteScope(scope) || !types.length}>{building ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
