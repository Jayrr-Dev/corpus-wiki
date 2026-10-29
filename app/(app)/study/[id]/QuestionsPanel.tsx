"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNote, TextLink } from "@/app/(app)/_components/bits";
import { useIsAdminMode } from "@/components/shell/useNavMode";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Tooltip } from "@/components/standard/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STUDY_KIND_LABELS, type StudyClaim, type StudyItemRow } from "@/lib/study/types";
import { regenerate, removeQuestion } from "../studyApi";
import { EditQuestion, NewQuestionButton } from "./QuestionForms";

// REMOVE: says what goes before it goes
function RemoveQuestion({ item, onDone }: { item: StudyItemRow; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await removeQuestion(item.id);
      onDone();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  };
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Remove this question?</DialogTitle>
        <DialogDescription>It leaves the set. Your levels on its claim stay.</DialogDescription>
      </DialogHeader>
      <ErrorNote error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="button" variant="destructive" onClick={remove} disabled={pending}>{pending ? "Removing…" : "Remove"}</Button>
      </DialogFooter>
    </div>
  );
}

// QUESTIONS: every item with its type, claim and stale flag; Regenerate and Remove in the row menu
export function QuestionsPanel({ setId, items, claims }: { setId: string; items: StudyItemRow[]; claims: StudyClaim[] }) {
  const router = useRouter();
  const isAdmin = useIsAdminMode();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimOf = new Map(claims.map((claim) => [claim.unitId, claim]));
  const addRow = isAdmin ? <div className="flex justify-end"><NewQuestionButton setId={setId} claims={claims} /></div> : null;

  const rewrite = async (item: StudyItemRow) => {
    setBusy(item.id);
    setError(null);
    try {
      await regenerate(item.id);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(null); }
  };

  if (!items.length) return <div className="grid gap-3">{addRow}<p className="text-panel text-muted-foreground">No questions yet.</p></div>;
  return (
    <div className="grid gap-3">
      {addRow}
      <ErrorNote error={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">Type</TableHead>
            <TableHead>Question</TableHead>
            <TableHead>Claim</TableHead>
            <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const claim = claimOf.get(item.unitId);
            return (
              <TableRow key={item.id}>
                <TableCell>{STUDY_KIND_LABELS[item.kind]}</TableCell>
                <TableCell className="whitespace-normal">
                  {item.prompt}
                  {busy === item.id ? <span className="ml-2 text-muted-foreground">Rewriting…</span> : null}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-wrap items-center gap-2">
                    <TextLink href={`/units/${item.unitId}`}>{claim?.title || claim?.content || "Claim"}</TextLink>
                    {item.stale ? (
                      <Tooltip content={claim?.retired ? "The claim was retired." : "The claim changed since this was written."}>
                        <Badge variant="outline">Stale</Badge>
                      </Tooltip>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <RowMenu label={item.prompt} items={[
                    ...(isAdmin ? [{ label: "Edit", body: (close: () => void) => <EditQuestion item={item} onDone={close} /> }] : []),
                    { label: "Regenerate", isDisabled: busy !== null, run: () => void rewrite(item) },
                    { label: "Remove", isDestructive: true, body: (close) => <RemoveQuestion item={item} onDone={close} /> },
                  ]} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
