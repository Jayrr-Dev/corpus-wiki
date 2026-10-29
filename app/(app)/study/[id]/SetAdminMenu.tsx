"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useIsAdminMode } from "@/components/shell/useNavMode";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StudySetRow } from "@/lib/study/types";
import { deleteSet, renameSet } from "../studyApi";

// RENAME: the set's title
function RenameSet({ set, onDone }: { set: StudySetRow; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(set.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await renameSet(set.id, title.trim());
      onDone();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  };
  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename set</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="study-set-title">Title</Label>
        <Input id="study-set-title" value={title} maxLength={200} required autoFocus onChange={(event) => setTitle(event.target.value)} disabled={pending} />
      </div>
      <ErrorNote error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !title.trim()}>{pending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  );
}

// DELETE: says what goes before it goes; deletion cannot be undone
function DeleteSet({ set, questions, onDone }: { set: StudySetRow; questions: number; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await deleteSet(set.id);
      onDone();
      router.push("/study");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setPending(false);
    }
  };
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Delete “{set.title}” forever?</DialogTitle>
        <DialogDescription>
          This deletes the set and its {questions} question{questions === 1 ? "" : "s"}, with every answer written to them. This cannot be undone. Your levels on the claims stay.
        </DialogDescription>
      </DialogHeader>
      <ErrorNote error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="button" variant="destructive" onClick={remove} disabled={pending}>{pending ? "Deleting…" : "Delete set forever"}</Button>
      </DialogFooter>
    </div>
  );
}

// SET MENU (admin mode only): Rename and Delete for one study set, in the page header
export function SetAdminMenu({ set, questions }: { set: StudySetRow; questions: number }) {
  const isAdmin = useIsAdminMode();
  if (!isAdmin) return null;
  return (
    <RowMenu label={set.title} items={[
      { label: "Rename", body: (close: () => void) => <RenameSet set={set} onDone={close} /> },
      { label: "Delete set", isDestructive: true, body: (close: () => void) => <DeleteSet set={set} questions={questions} onDone={close} /> },
    ]} />
  );
}
