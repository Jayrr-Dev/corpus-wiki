"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MODEL_ROLES, type ModelRole, roleName } from "@/lib/ai/roles";
import type { ReasoningEffort } from "@/lib/ai/chat";
import { chooseRoleEffort, chooseRoleModel } from "@/lib/server-actions/settings";
import { ROLE_ICONS } from "@/app/(app)/skills/roleIcons";
import { usesEffort } from "@/lib/ai/effortSupport";
import { EFFORTS } from "./AiEffort";
import type { ModelSettings } from "./loadModelSettings";

// =====================================================================
// MODEL BY ROLE: each AI role can run on its own model instead of the
// active one, e.g. a fast model for the Writer, a smart one for the
// reviewers, a cheap one for the Media analyst, each with its own effort
// beside it. Saved on change.
// =====================================================================

export function RoleModels({ settings }: { settings: ModelSettings }) {
  const router = useRouter();
  const save = useServerAction(chooseRoleModel);
  const saveEffort = useServerAction(chooseRoleEffort);
  const [pending, setPending] = useState<ModelRole | null>(null);
  const isSaving = save.isPending || saveEffort.isPending;

  const apply = async (role: ModelRole, model: string | null) => {
    setPending(role);
    const result = await save.run(role, model);
    setPending(null);
    if (result.ok) router.refresh();
  };

  const applyEffort = async (role: ModelRole, effort: ReasoningEffort | null) => {
    setPending(role);
    const result = await saveEffort.run(role, effort);
    setPending(null);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul aria-label="Model by role" className="divide-y overflow-hidden rounded-xl border">
        {MODEL_ROLES.map((role) => {
          const Icon = ROLE_ICONS[role] ?? Sparkles;
          const current = settings.roleModels[role] ?? "";
          // A saved pick the provider no longer lists stays visible, so it can be seen and cleared
          // The effort select turns off when the role's model ignores effort
          const effortOn = usesEffort(current || settings.activeModel);
          const options = current && !settings.models.includes(current) ? [current, ...settings.models] : settings.models;
          return (
            <li key={role} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,22rem)_auto] sm:items-center">
              <div className="flex min-w-0 items-center gap-2.5">
                <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <span className="truncate text-panel font-medium">{roleName(role)}</span>
              </div>
              <NativeSelect
                aria-label={`Model for ${roleName(role)}`}
                className="min-w-0"
                value={current}
                disabled={isSaving || options.length === 0}
                onChange={(event) => void apply(role, event.target.value || null)}
              >
                <NativeSelectOption value="">Active model</NativeSelectOption>
                {options.map((model) => <NativeSelectOption key={model} value={model}>{model}</NativeSelectOption>)}
              </NativeSelect>
              <NativeSelect
                aria-label={`Effort for ${roleName(role)}`}
                value={effortOn ? (settings.roleEfforts[role] ?? "") : "off"}
                disabled={isSaving || !effortOn}
                onChange={(event) => void applyEffort(role, (event.target.value || null) as ReasoningEffort | null)}
              >
                {effortOn ? null : <NativeSelectOption value="off">Not used</NativeSelectOption>}
                <NativeSelectOption value="">Default effort</NativeSelectOption>
                {EFFORTS.map(({ value, label }) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
              </NativeSelect>
              {pending === role ? <span role="status" className="text-xs text-faint sm:col-start-2">Saving…</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-faint">The Extractor and Organizer guide the Reconciler’s request, so they use its model. Unnamed steps (topic placement, entity clean-up, stakeholder cards, chat) use the active model.</p>
      <ErrorNote error={save.error ?? saveEffort.error} />
    </div>
  );
}
