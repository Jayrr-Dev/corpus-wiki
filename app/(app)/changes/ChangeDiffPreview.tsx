"use client";

import { SplitDiff } from "@/components/diff/DiffView";
import { useActions } from "@/lib/queries";
import { useActionTexts } from "./useActionTexts";

// How many edits the hover shows before "+N more"
const SHOWN = 3;

// DIFF PREVIEW (the Summary hover): the text each action changed, before on
// the left with removed words struck and after on the right with added words
// underlined (a removed or new line leaves its other side a dash). Mounts only while the tooltip is open, so it
// loads on hover; until then, and for changes with no text, the summary.
export function ChangeDiffPreview({ changeSetId, summary }: { changeSetId: string; summary: string }) {
  const actions = useActions({ filters: { change_set_id: changeSetId } });
  const { queries, textsOf } = useActionTexts(actions.data ?? []);
  const edits = (actions.data ?? []).map((action) => ({ id: action.id, ...textsOf(action) })).filter((edit) => edit.before !== null || edit.after !== null);

  if (!actions.data || queries.some((query) => !query.data) || edits.length === 0) return <span className="block max-w-96">{summary}</span>;
  return (
    // Struck words keep the bubble's own color (the page's muted grey is unreadable on it)
    <div className="flex w-[36rem] max-w-full flex-col gap-2 [&_.line-through]:text-current [&_.line-through]:opacity-60">
      <div className="grid grid-cols-2 gap-x-4 opacity-60">
        <span>Before</span>
        <span>After</span>
      </div>
      {edits.slice(0, SHOWN).map((edit) => (
        <SplitDiff key={edit.id} before={edit.before ?? ""} after={edit.after ?? ""} />
      ))}
      {edits.length > SHOWN ? <span className="opacity-70">+{edits.length - SHOWN} more</span> : null}
    </div>
  );
}
