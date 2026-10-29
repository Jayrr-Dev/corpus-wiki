"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { CoveragePicker } from "@/components/knowledge/CoveragePicker";
import { ScopePicker } from "@/components/knowledge/ScopePicker";
import { InfoHint } from "@/components/standard/info-hint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type Coverage, isCompleteScope, type Scope, type ScopeOptions } from "@/lib/knowledge/scopeTypes";
import { STUDY_KINDS, type StudyKind } from "@/lib/study/types";
import { createSet } from "./studyApi";

// The checkbox labels in the New set form (plural, as the plan words them)
const KIND_CHOICES: Record<StudyKind, string> = { flashcard: "Flashcards", multiple_choice: "Multiple choice", short_answer: "Short answer" };

// A set is named after its source
function setTitle(scope: Scope, options: ScopeOptions): string {
  if (scope.kind === "glossary") return "Glossary";
  return options[scope.kind].find((option) => option.id === scope.id)?.label ?? "Study set";
}

function FieldLabel({ id, label, hint }: { id?: string; label: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span id={id} className="text-sm font-medium">{label}</span>
      {hint ? <InfoHint>{hint}</InfoHint> : null}
    </div>
  );
}

// NEW SET: source, coverage and question types; Create writes the questions with a running count
export function NewSetButton({ options }: { options: ScopeOptions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(100);
  const [types, setTypes] = useState<StudyKind[]>([...STUDY_KINDS]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (kind: StudyKind, on: boolean) => setTypes((current) => STUDY_KINDS.filter((item) => (item === kind ? on : current.includes(item))));
  const reset = () => { setScope(null); setCoverage(100); setTypes([...STUDY_KINDS]); setProgress(null); setError(null); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCompleteScope(scope) || !types.length) return;
    setBuilding(true);
    setError(null);
    try {
      const id = await createSet({ title: setTitle(scope, options), scope, coverage, types }, (done, total) => setProgress({ done, total }));
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
              <ScopePicker options={options} value={scope} onChange={setScope} disabled={building} />
            </div>
            <div>
              <FieldLabel label="Coverage" hint="Below 100%, the most-cited claims come first." />
              <CoveragePicker value={coverage} onChange={setCoverage} disabled={building} />
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
            {building ? (
              <p role="status" className="text-panel text-muted-foreground">
                {progress?.total ? `Writing ${progress.total} questions… ${progress.done} / ${progress.total}` : "Writing questions…"}
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
