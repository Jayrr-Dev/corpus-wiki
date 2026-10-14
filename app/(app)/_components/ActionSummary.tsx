import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { TextLink } from "@/app/(app)/_components/bits";
import { describeActionInput, humanize } from "@/app/(app)/_lib/format";
import { ACTION_TONE } from "@/app/(app)/_lib/tone";
import type { Enums, Tables } from "@/lib/database/types";

// ACTION TYPES WHOSE TARGET IS A UNIT (creates record the new unit as target once applied)
export const UNIT_ACTION_TYPES: ReadonlySet<Enums<"action_type">> = new Set([
  "add_claim",
  "revise_claim",
  "retire_claim",
  "link",
  "set_epistemic_status",
  "merge_duplicates",
]);

// Where an action's target lives: units, entities, or a domain's filtered unit list
export function targetHref(type: Enums<"action_type">, targetId: string | null): string | null {
  if (!targetId || type.endsWith("_line")) return null; // lines are read on their page, not alone
  if (type === "create_domain") return `/units?domain=${targetId}`;
  if (type === "create_entity") return `/entities/${targetId}`;
  return `/units/${targetId}`;
}

// TARGET LINK WORDS PER TYPE
function targetLabel(type: Enums<"action_type">): string {
  if (type === "create_domain") return "Open domain";
  if (type === "create_entity") return "Open entity";
  return "Open unit";
}

// ACTION SUMMARY: position, type, outcome, speech act and target, then the input in one line
export function ActionSummary({ action }: { action: Tables<"actions"> }) {
  const href = targetHref(action.type, action.target_id);
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-panel">
        <span className="font-mono text-faint">#{action.position}</span>
        <span className="font-medium">{humanize(action.type)}</span>
        <StatusDot tone={ACTION_TONE[action.outcome]} label={action.outcome} />
        {action.speech_act ? <span className="text-muted-foreground">{action.speech_act}</span> : null}
        {href ? <TextLink href={href}>{targetLabel(action.type)}</TextLink> : null}
      </p>
      <p className="text-panel">{describeActionInput(action.type, action.input)}</p>
    </div>
  );
}
