"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Note, TextLink } from "@/app/(app)/_components/bits";
import { useTimeZone } from "@/app/(app)/_components/DateTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { levelLabel } from "@/lib/study/levels";
import { pickQueue, SESSION_LIMIT } from "@/lib/study/session";
import { type AnswerOutcome, STUDY_KIND_LABELS, type StudyClaim, type StudyItemRow, type StudyProgressRow } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { answer, type Answer } from "./studyApi";

const RESULT_TEXT = { right: "Right", partly: "Partly right", wrong: "Wrong" } as const;
const RESULT_TONE = { right: "text-applied", partly: "text-needs-you", wrong: "text-failed" } as const;

// The claim a question came from, linking to the claim and its sources
function SourceClaim({ item, claims }: { item: StudyItemRow; claims: ReadonlyMap<string, StudyClaim> }) {
  const claim = claims.get(item.unitId);
  return (
    <p className="text-panel text-muted-foreground">
      <TextLink href={`/units/${item.unitId}`}>{claim?.title || "Source claim"}</TextLink>
      {claim?.content ? <>: {claim.content}</> : null}
    </p>
  );
}

// ONE CARD: a flashcard, multiple choice (keys 1–4) or short answer, then its outcome
function Card({ item, claims, onAnswered, onNext }: { item: StudyItemRow; claims: ReadonlyMap<string, StudyClaim>; onAnswered: (outcome: AnswerOutcome) => void; onNext: () => void }) {
  const timeZone = useTimeZone();
  const [shown, setShown] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [written, setWritten] = useState("");
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (input: Omit<Answer, "itemId" | "timeZone">, thenNext = false) => {
    setPending(true);
    setError(null);
    try {
      const result = await answer({ itemId: item.id, timeZone, ...input });
      onAnswered(result);
      if (thenNext) onNext(); else setOutcome(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  };

  const choose = (choice: string) => {
    if (outcome || pending) return;
    setPicked(choice);
    void send({ response: choice });
  };

  // Multiple choice: keys 1–4 pick an option; once answered, Enter moves on
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (item.kind === "multiple_choice" && !outcome && !pending && /^[1-4]$/.test(event.key)) {
        const choice = item.choices?.[Number(event.key) - 1];
        if (choice) { event.preventDefault(); choose(choice); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-xl border px-6 py-5">
      <Badge variant="outline" className="self-start">{STUDY_KIND_LABELS[item.kind]}</Badge>
      <p className="text-lg font-medium whitespace-pre-wrap">{item.prompt}</p>

      {item.kind === "flashcard" ? (
        shown ? (
          <>
            <p className="whitespace-pre-wrap">{item.answer}</p>
            <SourceClaim item={item} claims={claims} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => void send({ result: "wrong" }, true)}>Again</Button>
              <Button type="button" disabled={pending} onClick={() => void send({ result: "right" }, true)}>Got it</Button>
            </div>
          </>
        ) : <Button type="button" className="self-start" onClick={() => setShown(true)}>Show answer</Button>
      ) : null}

      {item.kind === "multiple_choice" ? (
        <ol className="grid gap-2">
          {(item.choices ?? []).map((choice, index) => {
            const isAnswer = outcome && choice === item.answer;
            const isWrongPick = outcome && choice === picked && choice !== item.answer;
            return (
              <li key={choice}>
                <button
                  type="button"
                  disabled={!!outcome || pending}
                  onClick={() => choose(choice)}
                  className={cn("flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left hover:bg-muted/50 disabled:hover:bg-transparent",
                    isAnswer && "border-applied bg-applied/10", isWrongPick && "border-failed bg-failed/10", !outcome && picked === choice && "bg-muted")}
                >
                  <Kbd>{index + 1}</Kbd>
                  <span>{choice}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      {item.kind === "short_answer" && !outcome ? (
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void send({ response: written }); }}>
          <Textarea aria-label="Your answer" value={written} maxLength={2000} disabled={pending} onChange={(event) => setWritten(event.target.value)} />
          <Button type="submit" className="self-start" disabled={pending || !written.trim()}>{pending ? "Checking…" : "Check"}</Button>
        </form>
      ) : null}

      <ErrorNote error={error} />

      {outcome ? (
        <div className="grid gap-2 border-t pt-3">
          <p className={cn("font-medium", RESULT_TONE[outcome.result])}>
            {RESULT_TEXT[outcome.result]} <span className="font-normal text-muted-foreground">· {levelLabel(outcome.progress.level)}</span>
          </p>
          {outcome.feedback ? <p className="text-panel">{outcome.feedback}</p> : null}
          {item.kind === "short_answer" ? <p className="text-panel"><span className="text-muted-foreground">Answer:</span> {item.answer}</p> : null}
          {item.explanation && item.kind === "multiple_choice" ? <p className="text-panel">{item.explanation}</p> : null}
          <SourceClaim item={item} claims={claims} />
          <Button type="button" className="self-start" onClick={onNext} autoFocus>Next</Button>
        </div>
      ) : null}
    </div>
  );
}

// PRACTICE: the due questions one card at a time, with `8 / 20` and End in the footer.
// `items` and `progress` are the person's at load; a session takes one question per due claim.
// A test passes `all` (every claim comes up, due or not) and a `limit` that covers the whole pool.
export function Practice({ items, claims, progress, emptyText = "Nothing due.", all = false, limit = SESSION_LIMIT }: { items: StudyItemRow[]; claims: StudyClaim[]; progress: StudyProgressRow[]; emptyText?: string; all?: boolean; limit?: number }) {
  const router = useRouter();
  const claimMap = new Map(claims.map((claim) => [claim.unitId, claim]));
  // The first question per claim on load (no randomness, so the server and browser agree)
  const [queue, setQueue] = useState(() => pickQueue(items, progress, new Date(), { all, limit, random: () => 0 }));
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [ended, setEnded] = useState(false);

  const start = (again: boolean) => {
    setQueue(pickQueue(items, progress, new Date(), { all: again, limit }));
    setIndex(0);
    setAnswered(0);
    setEnded(false);
  };
  const end = () => { setEnded(true); router.refresh(); };

  const current = ended ? undefined : queue[index];
  if (!current) {
    const practicable = items.some((item) => !item.stale);
    const stopped = ended && index < queue.length;
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Note>{queue.length ? `Done: ${answered} / ${queue.length}.` : emptyText}</Note>
        <div className="flex gap-2">
          {stopped ? <Button type="button" onClick={() => setEnded(false)}>Continue</Button> : null}
          {practicable ? <Button type="button" variant="outline" onClick={() => start(true)}>Practice all</Button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <Card key={`${current.id}:${index}`} item={current} claims={claimMap} onAnswered={() => setAnswered((count) => count + 1)} onNext={() => {
        if (index + 1 >= queue.length) { setIndex(queue.length); router.refresh(); } else setIndex(index + 1);
      }} />
      <div className="flex w-full max-w-xl items-center justify-between text-panel text-muted-foreground">
        <span>{index + 1} / {queue.length}</span>
        <Button type="button" variant="ghost" size="sm" onClick={end}>End</Button>
      </div>
    </div>
  );
}
