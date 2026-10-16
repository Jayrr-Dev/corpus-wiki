"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { answerException } from "@/lib/server-actions/knowledge";

type AnswerFormProps = {
  recommendationOnly?: boolean;
  exceptionId: string;
  // Called as soon as a button is pressed, so the card collapses at once
  onDecided: (accept: boolean) => void;
  // Called when saving failed; the card reopens with this message
  onFailed: (error: string) => void;
  // The last failure, kept by the card because this form remounts when it reopens
  error: string | null;
};

// ANSWER FORM: an optional note, then Accept (apply the held action) or Reject (drop it), on one row
export function AnswerForm({ exceptionId, onDecided, onFailed, error, recommendationOnly = false }: AnswerFormProps) {
  const [note, setNote] = useState("");
  const answer = useServerAction(answerException);
  const send = async (accept: boolean) => {
    onDecided(accept);
    const result = await answer.run(exceptionId, accept, note.trim() || null);
    if (!result.ok) onFailed(result.error);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Note (optional)"
          placeholder="Add a note (optional)"
          className="min-w-48 flex-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button variant="outline" disabled={answer.isPending} onClick={() => void send(false)}>
          Reject
        </Button>
        <Button disabled={answer.isPending} onClick={() => void send(true)}>
          {recommendationOnly ? "Acknowledge recommendation" : "Approve change"}
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
