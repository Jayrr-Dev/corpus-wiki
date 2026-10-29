"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InfoHint } from "@/components/standard/info-hint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LEVELS, LEVEL_LABELS, type LevelKey } from "@/lib/study/levels";
import { STUDY_KINDS, type StudyKind } from "@/lib/study/types";

// One set a Test can cover: its label as the list shows it, and its claim count
export type TestSetOption = { id: string; label: string; claims: number };

// The question-type checkbox labels (plural, as the New set form words them)
const KIND_CHOICES: Record<StudyKind, string> = { flashcard: "Flashcards", multiple_choice: "Multiple choice", short_answer: "Short answer" };

// TEST BUTTON: on a section's header, opens a dialog to pick its sets and coverage levels,
// then runs a test on the questions already in the pool. Nothing new is written.
// Every set and level is on each time the dialog opens.
// The top heading's run is an EXAM; the rest are Tests
export type TestKind = "test" | "exam";
const KIND_LABELS: Record<TestKind, string> = { test: "Test", exam: "EXAM" };

export function TestButton({ name, sets, kind = "test" }: { name: string; sets: TestSetOption[]; kind?: TestKind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [levels, setLevels] = useState<LevelKey[]>([...LEVELS]);
  const [kinds, setKinds] = useState<StudyKind[]>([...STUDY_KINDS]);

  const change = (next: boolean) => {
    if (next) {
      setPicked(sets.map((set) => set.id));
      setLevels([...LEVELS]);
      setKinds([...STUDY_KINDS]);
    }
    setOpen(next);
  };

  const toggleSet = (id: string, on: boolean) => setPicked(sets.filter((set) => (set.id === id ? on : picked.includes(set.id))).map((set) => set.id));
  const toggleLevel = (level: LevelKey, on: boolean) => setLevels(LEVELS.filter((item) => (item === level ? on : levels.includes(item))));
  const toggleKind = (kind: StudyKind, on: boolean) => setKinds(STUDY_KINDS.filter((item) => (item === kind ? on : kinds.includes(item))));

  const start = () => {
    const query = new URLSearchParams({ sets: picked.join(","), levels: levels.join(","), types: kinds.join(","), name, kind });
    router.push(`/study/test?${query.toString()}`);
  };

  const ready = picked.length > 0 && levels.length > 0 && kinds.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={`More options for ${name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => change(true)}>{KIND_LABELS[kind]}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{KIND_LABELS[kind]}: {name}</DialogTitle>
            <DialogDescription>Questions already in the pool, one per claim.</DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              Sections
              <InfoHint>Each set in this section. All are on at first.</InfoHint>
            </legend>
            <div className="grid max-h-56 gap-1 overflow-y-auto">
              {sets.map((set) => (
                <label key={set.id} className="flex items-center gap-2 py-1 text-panel">
                  <input type="checkbox" className="accent-link" checked={picked.includes(set.id)} onChange={(event) => toggleSet(set.id, event.target.checked)} />
                  <span className="min-w-0 truncate">{set.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{set.claims} claim{set.claims === 1 ? "" : "s"}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              Coverage
              <InfoHint>Only claims at the levels you tick come up.</InfoHint>
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {LEVELS.map((level) => (
                <label key={level} className="flex items-center gap-2 text-panel">
                  <input type="checkbox" className="accent-link" checked={levels.includes(level)} onChange={(event) => toggleLevel(level, event.target.checked)} />
                  {LEVEL_LABELS[level]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              Questions
              <InfoHint>Only questions of the types you tick come up.</InfoHint>
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {STUDY_KINDS.map((kindOption) => (
                <label key={kindOption} className="flex items-center gap-2 text-panel">
                  <input type="checkbox" className="accent-link" checked={kinds.includes(kindOption)} onChange={(event) => toggleKind(kindOption, event.target.checked)} />
                  {KIND_CHOICES[kindOption]}
                </label>
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!ready} onClick={start}>Start test</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
