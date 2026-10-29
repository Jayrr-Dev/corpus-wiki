"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Sparkles } from "lucide-react";
import { InfoPopover } from "@/components/standard/info-popover";
import { Masonry } from "@/components/standard/masonry";
import { Tooltip } from "@/components/standard/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/components/actions/useServerAction";
import { RoleSpendPanel, useAllAiCalls, useRoleSpend } from "@/components/usage/RoleSpend";
import type { DayRange } from "@/components/usage/heatmapCells";
import { callsInRange } from "@/components/usage/summarizeUsage";
import type { RoleTotal } from "@/components/usage/summarizeUsage";
import { saveRoleInstructions } from "@/lib/server-actions/skills";
import { setRoleAuto } from "@/lib/server-actions/settings";
import { formatCount } from "@/app/(app)/_lib/format";
import { formatUsd } from "@/lib/ai/pricing";
import { AI_STAGES, type SkillLibrary } from "@/lib/ai/skills/types";
import type { MemoryEntry } from "@/lib/ai/memory";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { AUTO_ROLES, type AutoRole, FIXED_ROLES, MODEL_ROLES, type ModelRole, STAGE_ROLES } from "@/lib/ai/roles";
import { UndoIcon } from "@/components/icons";
import { ROLE_ICONS } from "../workflow/roleIcons";
import { RoleMemoryPanel } from "./RoleMemoryPanel";
import { RoleModelControls, RoleSends } from "../settings/RoleModels";
import type { ModelSettings } from "../settings/loadModelSettings";
import { ACTION_HINTS, AI_FLOW_LANES } from "../workflow/aiFlowModel";

// THE EXCEPTION KINDS EACH ROLE CAN RAISE, read from the AI flow so the cards and the flow agree
const ROLE_EXCEPTIONS = new Map<string, string[]>();
for (const node of AI_FLOW_LANES.flatMap((lane) => lane.nodes)) {
  if (!node.roleId || !node.exceptions?.length) continue;
  ROLE_EXCEPTIONS.set(node.roleId, [...new Set([...(ROLE_EXCEPTIONS.get(node.roleId) ?? []), ...node.exceptions])]);
}

// ROLES WHOSE INSTRUCTIONS THE APP MANAGES: they run on their own model (/settings) but have no editable
// instructions, so their cards show the model row and a note instead
const APP_ROLES = {
  media_analyst: { id: "media_analyst", name: "Media analyst", description: "Describes uploaded images and videos so they can be read as text." },
  reconciler: { id: "reconciler", name: "Reconciler", description: "Turns passages into claims, links and entities in one request, guided by the Extractor, Entity analyst, Linker, Organizer and Definer instructions." },
  deduplicator: { id: "deduplicator", name: "Deduplicator", description: "Finds and merges repeats: claims an upload added or revised, glossary entries, entities and topic names." },
  dictionary_editor: { id: "dictionary_editor", name: "Dictionary editor", description: "Writes cited glossary entries from live claims." },
} as const;
const appRole = (role: (typeof APP_ROLES)[keyof typeof APP_ROLES]) => ({ ...role, instructions: null, source: "Managed by the app", version: undefined });
const GUIDES_RECONCILER = new Set(["extract_knowledge", "link_knowledge", "organize_topics"]);

function rolePriceTip(range: DayRange | null, spent: RoleTotal | undefined): string {
  if (range !== null && spent === undefined) return "No calls on the days you picked.";
  const calls = formatCount(spent?.calls ?? 0);
  if (range !== null) return `Estimated spend for the days you picked. ${calls} calls.`;
  return `Estimated all-time spend in this space. ${calls} calls.`;
}

export function RolesTab({ library, modelSettings, initialMemory }: { library: SkillLibrary; modelSettings: ModelSettings; initialMemory?: Record<string, MemoryEntry[]> }) {
  const calls = useAllAiCalls();
  const [range, setRange] = useState<DayRange | null>(null);
  const priced = useMemo(() => callsInRange(calls.data ?? [], range), [calls.data, range]);
  const spend = useRoleSpend({ data: priced });
  const roles = AI_STAGES.map((stage) => {
    const assignment = library.assignments.find((item) => item.stage === stage.id);
    const skill = assignment ? library.skills.find((item) => item.id === assignment.skill_id) : defaultSkill(stage.id);
    return {
      id: stage.id, name: STAGE_ROLES[stage.id], description: stage.description,
      instructions: skill?.instructions ?? "App rules only; no additional skill instructions assigned.",
      source: skill?.name ?? "App rules only", version: skill?.version,
    };
  });
  const roster = [appRole(APP_ROLES.media_analyst), ...roles, appRole(APP_ROLES.reconciler), appRole(APP_ROLES.deduplicator), appRole(APP_ROLES.dictionary_editor), ...FIXED_ROLES.map((role) => ({
    ...role,
    source: "Fixed role policy", version: 1,
  }))];

  return <section aria-label="AI roles" className="space-y-5">
    <div className="flex items-center gap-2">
      <h2 className="text-xl font-semibold tracking-tight">The roster behind your workflow</h2>
      <InfoPopover label="About roles">
        <p>Each role has a responsibility and a set of instructions. Open a card’s instructions to see how it works.</p>
      </InfoPopover>
    </div>
    <RoleSpendPanel calls={calls} range={range} onRangeChange={setRange} />
    <Masonry columns={{ base: 1, sm: 2, xl: 3 }}>
      {roster.map((role, index) => {
        const Icon = ROLE_ICONS[role.id] ?? Sparkles;
        const override = library.roleInstructions?.find((item) => item.role === role.id);
        const exceptions = ROLE_EXCEPTIONS.get(role.id);
        const spent = spend.get(role.id);
        return <article key={role.id} aria-label={role.name} className="rounded-xl border bg-background p-1 shadow-sm">
          <div className="overflow-hidden rounded-lg border border-border/60">
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{role.name}</h2>
              <div className="flex shrink-0 items-center gap-2">
                {exceptions ? <Tooltip content={<div className="space-y-0.5"><p className="font-medium">Can hold changes for you in Exceptions</p>{exceptions.map((kind) => <p key={kind}>{ACTION_HINTS[kind]?.replace(/^Exception: (.)/, (_, first: string) => first.toUpperCase()) ?? kind}</p>)}</div>}>
                  <span><Badge variant="outline">Exceptions</Badge></span>
                </Tooltip> : null}
                {GUIDES_RECONCILER.has(role.id) ? <Tooltip content="These calls run inside the Reconciler request, so this card stays at zero.">
                  <span className="font-mono text-xs text-muted-foreground">{formatUsd(0)}</span>
                </Tooltip> : range !== null || spent ? <Tooltip content={rolePriceTip(range, spent)}>
                  <span className="font-mono text-xs text-muted-foreground">{formatUsd(spent?.costUsd ?? 0)}</span>
                </Tooltip> : null}
                <span className="font-mono text-xs text-faint">{String(index + 1).padStart(2, "0")}</span>
              </div>
            </header>
            <div aria-hidden="true" className="relative flex h-40 items-center justify-center overflow-hidden bg-muted/25">
              <div className="absolute size-44 rounded-full border border-border/40" />
              <div className="absolute size-32 rounded-full border border-border/60" />
              <div className="relative flex size-24 items-center justify-center rounded-full border bg-background text-foreground">
                <Icon size={40} strokeWidth={1.5} />
              </div>
            </div>
            <div className="flex min-h-44 flex-col border-t px-5 py-4">
              <p className="text-panel leading-relaxed text-muted-foreground">{role.description}</p>
              <div className="mt-auto flex items-start justify-between gap-3 pt-5 text-xs text-faint">
                <span>{override ? "Custom role instructions" : role.source}</span>
                {(override?.version ?? role.version) !== undefined ? <span className="shrink-0 font-mono">v{override?.version ?? role.version}</span> : null}
              </div>
            </div>
            <div className="space-y-2 border-t px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Model and effort</h3>
                <Tooltip content="The data this role sends its model. Only models that read it are offered."><span><RoleSends role={role.id} /></span></Tooltip>
              </div>
              {(MODEL_ROLES as readonly string[]).includes(role.id)
                ? <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><RoleModelControls role={role.id as ModelRole} settings={modelSettings} /></div>
                : <p className="text-panel text-faint">Uses the Reconciler’s model and effort.</p>}
            </div>
            {(AUTO_ROLES as readonly string[]).includes(role.id) ? <RoleFullAuto role={role.id as AutoRole} name={role.name} on={modelSettings.roleAuto.includes(role.id)} /> : null}
            <RoleInstructionsSection>
              {role.instructions === null
                ? <p className="border-t px-5 py-4 text-panel leading-relaxed text-muted-foreground">Managed by the app; not editable here.</p>
                : <RoleInstructions key={`${role.id}:${override?.version ?? "default"}:${role.instructions}`} role={role.id} name={role.name} instructions={override?.instructions ?? role.instructions} version={override?.version ?? null} />}
            </RoleInstructionsSection>
          </div>
        </article>;
      })}
    </Masonry>
    <RoleMemoryPanel initialMemory={initialMemory} />
  </section>;
}

// THE COLLAPSED INSTRUCTIONS: the body renders the first time it opens and then stays (an open
// edit survives closing it), so the page does not ship every role's instructions up front
function RoleInstructionsSection({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return <details className="group border-t" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-panel font-medium transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      Role instructions
      <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
    </summary>
    {opened ? children : null}
  </details>;
}

// FULL AUTO: what the role would hold in Exceptions is accepted at once, so it never waits for you
function RoleFullAuto({ role, name, on }: { role: AutoRole; name: string; on: boolean }) {
  const router = useRouter();
  const save = useServerAction(setRoleAuto);
  const id = `full-auto-${role}`;
  // Shows the new position while it saves; a failed save puts it back
  const [pending, setPending] = useState<boolean | null>(null);
  const checked = pending ?? on;
  async function apply(next: boolean) {
    setPending(next);
    const result = await save.run(role, next);
    if (result.ok) router.refresh();
    else setPending(null);
  }
  return <div className="space-y-1.5 border-t px-5 py-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-panel font-medium">Full auto</label>
        <InfoPopover label={`About full auto for the ${name}`}>
          <p>When on, the {name} doesn’t wait for you. Whatever it would hold in Exceptions is accepted right away, with a note saying it was automatic. You can still undo it in Changes.</p>
          <p>A new root topic still waits for your approval.</p>
        </InfoPopover>
      </div>
      <Switch id={id} checked={checked} disabled={save.isPending} onCheckedChange={(next) => void apply(next)} />
    </div>
    {save.error ? <p role="alert" className="text-panel text-failed">{save.error}</p> : null}
  </div>;
}

function RoleInstructions({ role, name, instructions, version }: { role: string; name: string; instructions: string; version: number | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(instructions);
  const save = useServerAction(saveRoleInstructions);
  async function submit(value: string | null) {
    const result = await save.run(role, value, version);
    if (result.ok) setEditing(false);
  }
  return <div className="group/instructions relative border-t px-5 py-4">
    {editing ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(draft); }}>
      <Textarea autoFocus aria-label={`${name} instructions`} value={draft} onChange={(event) => setDraft(event.target.value)} required maxLength={20000} disabled={save.isPending} className="min-h-72 resize-y" />
      <p className="text-xs text-faint">Changes apply to future runs.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => { setDraft(instructions); setEditing(false); save.reset(); }}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending || !draft.trim() || draft.trim() === instructions}>{save.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </form> : <>
      <div className="float-right -mt-0.5 -mr-1 mb-1 ml-2 flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/instructions:opacity-100 sm:group-focus-within/instructions:opacity-100">
        {version !== null ? <Tooltip content="Restore original instructions"><button type="button" aria-label={`Restore original ${name} instructions`} disabled={save.isPending} onClick={() => void submit(null)} className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><UndoIcon size={12} /></button></Tooltip> : null}
        <Tooltip content="Edit instructions"><button type="button" aria-label={`Edit ${name} instructions`} disabled={save.isPending} onClick={() => setEditing(true)} className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><Pencil size={12} /></button></Tooltip>
      </div>
      <p className="text-panel leading-relaxed whitespace-pre-wrap text-muted-foreground">{instructions}</p>
    </>}
    {save.error ? <p role="alert" className="mt-3 text-panel text-failed">{save.error}</p> : null}
  </div>;
}


