"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ReasoningEffort } from "@/lib/ai/chat";
import { chooseAiEffort } from "@/lib/server-actions/settings";
import { usesEffort } from "@/lib/ai/effortSupport";
import { InfoPopover } from "@/components/standard/info-popover";

// =====================================================================
// DEFAULT EFFORT: how hard AI calls think before they answer. Saved on
// change; a role or stage tuned to its own effort (extraction runs low) keeps it.
// Sits beside the model picker's buttons, and turns off for a model that
// ignores effort (Nemotron 3).
// =====================================================================

export const EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// `model` is the model the effort would apply to (the one picked in the list)
export function AiEffort({ effort, model }: { effort: ReasoningEffort | null; model: string }) {
  const supported = usesEffort(model);
  const router = useRouter();
  const save = useServerAction(chooseAiEffort);

  const apply = async (next: ReasoningEffort) => {
    const result = await save.run(next === "medium" ? null : next);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor="ai-effort" className="text-panel font-medium">{save.isPending ? "Saving…" : "Effort"}</label>
          <InfoPopover label="About effort">
            <p>How much the model thinks before it answers. Low is fastest and cheapest; high reads most carefully but takes longer and costs more.</p>
            <p className="mt-2">An answer that runs out of room is retried one step lower. Roles and stages tuned to their own effort keep it, and models that don&apos;t reason (Nemotron 3) ignore it.</p>
          </InfoPopover>
        </div>
        <NativeSelect id="ai-effort" size="sm" value={supported ? (effort ?? "medium") : "off"} disabled={save.isPending || !supported} onChange={(event) => void apply(event.target.value as ReasoningEffort)}>
          {supported ? null : <NativeSelectOption value="off">Not used</NativeSelectOption>}
          {EFFORTS.map(({ value, label }) => <NativeSelectOption key={value} value={value}>{value === "medium" ? `${label} (default)` : label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}
