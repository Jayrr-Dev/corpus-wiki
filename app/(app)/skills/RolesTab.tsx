"use client";

import { useState, type ComponentType } from "react";
import { Pencil } from "lucide-react";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/components/actions/useServerAction";
import { saveRoleInstructions } from "@/lib/server-actions/skills";
import { AI_STAGES, type SkillLibrary } from "@/lib/ai/skills/types";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { FIXED_ROLES, STAGE_ROLES } from "@/lib/ai/roles";
import {
  DecisionIcon, DomainIcon, EntityIcon, GraphIcon, LinkIcon,
  PageIcon, PassageIcon, SkillIcon, UnitIcon, UndoIcon, type IconProps,
} from "@/components/icons";

const ROLE_ICONS: Record<string, ComponentType<IconProps>> = {
  extract_knowledge: PassageIcon, identify_entities: EntityIcon, link_knowledge: LinkIcon,
  organize_topics: DomainIcon, define_concepts: UnitIcon, plan_articles: GraphIcon,
  write_articles: PageIcon, researcher: SkillIcon, reviewer: DecisionIcon, domain_steward: DomainIcon, article_reviewer: DecisionIcon,
};

export function RolesTab({ library }: { library: SkillLibrary }) {
  const roles = AI_STAGES.map((stage) => {
    const assignment = library.assignments.find((item) => item.stage === stage.id);
    const skill = assignment ? library.skills.find((item) => item.id === assignment.skill_id) : defaultSkill(stage.id);
    return {
      id: stage.id, name: STAGE_ROLES[stage.id], description: stage.description,
      instructions: skill?.instructions ?? "App rules only; no additional skill instructions assigned.",
      source: skill?.name ?? "App rules only", version: skill?.version,
    };
  });
  const roster = [...roles, ...FIXED_ROLES.map((role) => ({
    ...role,
    source: "Fixed role policy", version: 1,
  }))];

  return <section aria-label="AI roles" className="space-y-5">
    <p className="max-w-2xl text-panel text-muted-foreground">The roster behind your workflow. Each role has a responsibility and a set of instructions. Open a card’s instructions to see how it works.</p>
    <div className="grid items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {roster.map((role, index) => {
        const Icon = ROLE_ICONS[role.id] ?? UnitIcon;
        const override = library.roleInstructions?.find((item) => item.role === role.id);
        return <article key={role.id} aria-label={role.name} className="rounded-xl border bg-background p-1 shadow-sm">
          <div className="overflow-hidden rounded-lg border border-border/60">
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{role.name}</h2>
              <span className="font-mono text-xs text-faint">{String(index + 1).padStart(2, "0")}</span>
            </header>
            <div aria-hidden="true" className="relative flex h-40 items-center justify-center overflow-hidden bg-muted/25">
              <div className="absolute size-44 rounded-full border border-border/40" />
              <div className="absolute size-32 rounded-full border border-border/60" />
              <div className="relative flex size-24 items-center justify-center rounded-full border bg-background text-foreground">
                <Icon size={40} />
              </div>
            </div>
            <div className="flex min-h-44 flex-col border-t px-5 py-4">
              <p className="text-panel leading-relaxed text-muted-foreground">{role.description}</p>
              <div className="mt-auto flex items-start justify-between gap-3 pt-5 text-xs text-faint">
                <span>{override ? "Custom role instructions" : role.source}</span>
                {(override?.version ?? role.version) !== undefined ? <span className="shrink-0 font-mono">v{override?.version ?? role.version}</span> : null}
              </div>
            </div>
            <details className="group border-t">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-panel font-medium transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                Role instructions
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <RoleInstructions key={`${role.id}:${override?.version ?? "default"}:${role.instructions}`} role={role.id} name={role.name} instructions={override?.instructions ?? role.instructions} version={override?.version ?? null} />
            </details>
          </div>
        </article>;
      })}
    </div>
  </section>;
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


