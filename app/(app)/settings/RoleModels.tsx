"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MODEL_ROLES, type ModelRole, ROLE_INPUTS, roleName } from "@/lib/ai/roles";
import { describeTypes, missingTypes, readsAll } from "@/lib/ai/modelInputs";
import type { ReasoningEffort } from "@/lib/ai/chat";
import { chooseRoleEffort, chooseRoleModel } from "@/lib/server-actions/settings";
import { ROLE_ICONS } from "@/app/(app)/workflow/roleIcons";
import { usesEffort } from "@/lib/ai/effortSupport";
import { cn } from "@/lib/utils";
import { EFFORTS } from "./AiEffort";
import type { ModelSettings } from "./loadModelSettings";

// =====================================================================
// MODEL BY ROLE: each AI role can run on its own model instead of the
// active one, e.g. a fast model for the Writer, a smart one for the
// reviewers, a cheap one for the Media analyst, each with its own effort
// beside it. Saved on change.
// =====================================================================

export function RoleModels({ settings }: { settings: ModelSettings }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul aria-label="Model by role" className="divide-y overflow-hidden rounded-xl border">
        {MODEL_ROLES.map((role) => {
          const Icon = ROLE_ICONS[role] ?? Sparkles;
          return (
            <li key={role} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,22rem)_auto] sm:items-center">
              <div className="flex min-w-0 items-center gap-2.5">
                <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <span className="truncate text-panel font-medium">{roleName(role)}</span>
                <RoleSends role={role} className="shrink-0" />
              </div>
              <RoleModelControls role={role} settings={settings} />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-faint">The Extractor and Organizer guide the Reconciler’s request, so they use its model. Unnamed steps (topic placement, entity clean-up, stakeholder cards, chat) use the active model. Each role is offered only the models that read the data it sends.</p>
    </div>
  );
}

// ONE ROLE'S MODEL AND EFFORT: the two selects, also shown on each role card on /roles.
// Renders as two grid cells plus a status line, so the parent lays them out.
// True once the page is interactive. The server HTML lists only each select's chosen model, so a page
// of role cards does not ship every model once per role; the full list fills in on hydration.
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

export function RoleModelControls({ role, settings }: { role: ModelRole; settings: ModelSettings }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const save = useServerAction(chooseRoleModel);
  const saveEffort = useServerAction(chooseRoleEffort);
  const isSaving = save.isPending || saveEffort.isPending;

  const apply = async (model: string | null) => {
    const result = await save.run(role, model);
    if (result.ok) router.refresh();
  };

  const applyEffort = async (effort: ReasoningEffort | null) => {
    const result = await saveEffort.run(role, effort);
    if (result.ok) router.refresh();
  };

  const current = settings.roleModels[role] ?? "";
  const needs = ROLE_INPUTS[role];
  const seesImages = needs.includes("image");
  // Only models that read the role's data are offered. A saved pick the provider no longer lists, or one
  // that cannot read that data, stays visible (marked) so it can be seen and cleared
  const fitting = settings.models.filter((model) => readsAll(settings.modelInputs[model], needs));
  const offered = current && !fitting.includes(current) ? [current, ...fitting] : fitting;
  const options = hydrated ? offered : offered.filter((model) => model === current);
  const optionLabel = (model: string) => {
    if (!settings.models.includes(model)) return `${model} (no longer offered)`;
    const missing = missingTypes(settings.modelInputs[model], needs);
    if (missing.length) return `${model} (cannot read ${describeTypes(missing).toLowerCase()})`;
    return settings.modelInputs[model]?.includes("image") && !seesImages ? `${model} · images` : model;
  };
  // The Media analyst falls back to the vision model, every other role to the active model
  const fallback = seesImages ? settings.visionModel : settings.activeModel;
  // The effort select turns off when the role's model ignores effort
  const effortOn = usesEffort(current || fallback);
  const error = save.error ?? saveEffort.error;
  return (
    <>
      <NativeSelect
        aria-label={`Model for ${roleName(role)}`}
        className="w-full min-w-0"
        value={current}
        disabled={isSaving || offered.length === 0}
        onChange={(event) => void apply(event.target.value || null)}
      >
        <NativeSelectOption value="">{seesImages ? "Vision model" : "Active model"}</NativeSelectOption>
        {options.map((model) => <NativeSelectOption key={model} value={model}>{optionLabel(model)}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect
        aria-label={`Effort for ${roleName(role)}`}
        value={effortOn ? (settings.roleEfforts[role] ?? "") : "off"}
        disabled={isSaving || !effortOn}
        onChange={(event) => void applyEffort((event.target.value || null) as ReasoningEffort | null)}
      >
        {effortOn ? null : <NativeSelectOption value="off">Not used</NativeSelectOption>}
        <NativeSelectOption value="">Default effort</NativeSelectOption>
        {EFFORTS.map(({ value, label }) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
      </NativeSelect>
      {isSaving ? <span role="status" className="text-xs text-faint sm:col-start-2">Saving…</span> : null}
      {error ? <div className="sm:col-span-full"><ErrorNote error={error} /></div> : null}
    </>
  );
}

// WHAT A ROLE SENDS ITS MODEL ("Text", "Text, images"), shown beside its model picker
export function RoleSends({ role, className }: { role: string; className?: string }) {
  const needs = ROLE_INPUTS[role as ModelRole] ?? ["text"];
  return <span className={cn("rounded-sm bg-hover px-1.5 text-xs text-muted-foreground", className)}>{describeTypes(needs)}</span>;
}
