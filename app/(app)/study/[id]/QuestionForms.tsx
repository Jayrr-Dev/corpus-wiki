"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CHOICE_COUNT, STUDY_KIND_LABELS, STUDY_KINDS, type StudyClaim, type StudyItemRow, type StudyKind } from "@/lib/study/types";
import { addQuestion, editQuestion } from "../studyApi";

// EDIT TEXT (admin mode): the question's prompt only; the answer and claim stay
export function EditQuestion({ item, onDone }: { item: StudyItemRow; onDone: () => void }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(item.prompt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await editQuestion(item.id, prompt.trim());
      onDone();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  };
  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Edit question</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="study-question-text">Question</Label>
        <Textarea id="study-question-text" value={prompt} maxLength={2000} required autoFocus onChange={(event) => setPrompt(event.target.value)} disabled={pending} />
      </div>
      <ErrorNote error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !prompt.trim()}>{pending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  );
}

// The answer's label depends on the type: a flashcard's back, the right option, or the expected answer
const ANSWER_LABEL: Record<StudyKind, string> = { flashcard: "Back", multiple_choice: "Right option", short_answer: "Expected answer" };

// NEW QUESTION (admin mode): one question on a claim already in the set; the form hides behind the button
export function NewQuestionButton({ setId, claims }: { setId: string; claims: StudyClaim[] }) {
  const router = useRouter();
  const choices = claims.filter((claim) => !claim.retired);
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [kind, setKind] = useState<StudyKind>("flashcard");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState<string[]>(Array(CHOICE_COUNT - 1).fill(""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setUnitId(""); setKind("flashcard"); setPrompt(""); setAnswer(""); setWrong(Array(CHOICE_COUNT - 1).fill("")); setError(null); };
  const close = (next: boolean) => { if (pending) return; setOpen(next); if (!next) reset(); };
  const selectedUnit = unitId || choices[0]?.unitId || "";
  const multiple = kind === "multiple_choice";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await addQuestion(setId, {
        unitId: selectedUnit, kind, prompt: prompt.trim(), answer: answer.trim(),
        wrongChoices: multiple ? wrong.map((option) => option.trim()) : [],
      });
      setOpen(false);
      reset();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!choices.length}>New question</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New question</DialogTitle>
              <DialogDescription>Written by hand, on a claim already in this set.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="study-question-claim">Claim</Label>
              <NativeSelect id="study-question-claim" value={selectedUnit} disabled={pending} onChange={(event) => setUnitId(event.target.value)}>
                {choices.map((claim) => <NativeSelectOption key={claim.unitId} value={claim.unitId}>{claim.title || "Untitled claim"}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="study-question-kind">Type</Label>
              <NativeSelect id="study-question-kind" value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as StudyKind)}>
                {STUDY_KINDS.map((item) => <NativeSelectOption key={item} value={item}>{STUDY_KIND_LABELS[item]}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="study-question-prompt">Question</Label>
              <Textarea id="study-question-prompt" value={prompt} maxLength={2000} required disabled={pending} onChange={(event) => setPrompt(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="study-question-answer">{ANSWER_LABEL[kind]}</Label>
              <Textarea id="study-question-answer" value={answer} maxLength={2000} required disabled={pending} onChange={(event) => setAnswer(event.target.value)} />
            </div>
            {multiple ? wrong.map((option, index) => (
              <div key={index} className="grid gap-2">
                <Label htmlFor={`study-question-wrong-${index}`}>Wrong option {index + 1}</Label>
                <Input id={`study-question-wrong-${index}`} value={option} maxLength={300} required disabled={pending}
                  onChange={(event) => setWrong((current) => current.map((item, at) => (at === index ? event.target.value : item)))} />
              </div>
            )) : null}
            <ErrorNote error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending || !selectedUnit || !prompt.trim() || !answer.trim()}>{pending ? "Adding…" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
