"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerException } from "@/lib/server-actions/knowledge";

// ANSWER FORM: an optional note, then Accept (apply the held action) or Reject (drop it)
export function AnswerForm({ exceptionId }: { exceptionId: string }) {
  const [note, setNote] = useState("");
  const answer = useServerAction(answerException);
  const send = (accept: boolean) => answer.run(exceptionId, accept, note.trim() || null);
  return (
    <div className="flex flex-col gap-2">
      <Textarea aria-label="Note (optional)" placeholder="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
      <ErrorNote error={answer.error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={answer.isPending} onClick={() => send(false)}>
          Reject
        </Button>
        <Button disabled={answer.isPending} onClick={() => send(true)}>
          {answer.isPending ? "Sending…" : "Accept"}
        </Button>
      </div>
    </div>
  );
}
