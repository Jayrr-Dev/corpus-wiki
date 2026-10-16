"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect } from "@/components/actions/OptionSelect";
import { useServerAction } from "@/components/actions/useServerAction";
import { submitEdit } from "@/lib/server-actions/knowledge";
import { useEntities } from "@/lib/queries";
import type { KnowledgeContext } from "@/lib/knowledge/context";
import type { Tables } from "@/lib/database/types";

const empty: KnowledgeContext = { entities: [], applicability: { status: "unspecified", entities: [], conditions: null } };

export function UnitContextEditor({ revision, context }: { revision: Tables<"revisions">; context: KnowledgeContext | null }) {
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [draft, setDraft] = useState<KnowledgeContext>(context ?? empty);
  const entities = useEntities();
  const save = useServerAction(submitEdit);
  const options = (entities.data ?? []).filter(entity => !entity.merged_into_id && !entity.retired_at);
  if (!editing) return <Button variant="outline" size="sm" onClick={() => { setDraft(context ?? empty); setEditing(true); }}>Edit context</Button>;
  return <form className="flex flex-col gap-3" onSubmit={async event => {
    event.preventDefault();
    const result = await save.run({ type: "revise_claim", targetId: revision.unit_id, expectedRevisionId: revision.id, passageIds: revision.passage_ids, speechAct: "stated", input: { content: revision.content, context: draft, rationale: "Corrected entity context and applicability." } });
    if (result.ok && result.status === "applied") setEditing(false);
    else if (result.ok) setOutcome("This correction was not applied. Review its checks in Changes or Exceptions.");
  }}>
    <fieldset disabled={save.isPending} className="flex flex-col gap-3">
      <legend className="mb-2 text-panel">About</legend>
      {draft.entities.map((entity, index) => <div key={`${entity.type}:${entity.key}`} className="flex items-center gap-2">
        <span className="flex-1 text-panel">{options.find(item => item.type === entity.type && item.key === entity.key)?.name ?? entity.key}</span>
        <OptionSelect label={`Role for ${entity.key}`} value={entity.role} options={["subject", "object", "mentioned"].map(role => ({ value: role, label: role }))} onChange={role => setDraft({ ...draft, entities: draft.entities.map((item, i) => i === index ? { ...item, role: role as typeof item.role } : item) })} />
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ ...draft, entities: draft.entities.filter((_, i) => i !== index) })}>Remove</Button>
      </div>)}
      <OptionSelect label="Add entity" value="" emptyLabel="Add an entity…" options={options.filter(entity => !draft.entities.some(item => item.type === entity.type && item.key === entity.key)).map(entity => ({ value: entity.id, label: `${entity.name} (${entity.type})` }))} onChange={id => {
        const entity = options.find(item => item.id === id);
        if (entity) setDraft({ ...draft, entities: [...draft.entities, { type: entity.type, key: entity.key, role: "subject" }] });
      }} />
      <label className="text-panel">Applies to</label>
      <OptionSelect label="Applicability" value={draft.applicability.status} options={[{ value: "unspecified", label: "Unspecified" }, { value: "general", label: "General knowledge" }, { value: "scoped", label: "Specific entities" }]} onChange={status => setDraft({ ...draft, applicability: { ...draft.applicability, status: status as KnowledgeContext["applicability"]["status"], entities: status === "scoped" ? draft.applicability.entities : [], conditions: status === "scoped" ? draft.applicability.conditions : null } })} />
      {draft.applicability.status === "scoped" && <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">{options.map(entity => <label key={entity.id} className="flex items-center gap-2 text-panel"><input type="checkbox" checked={draft.applicability.entities.some(item => item.type === entity.type && item.key === entity.key)} onChange={event => setDraft({ ...draft, applicability: { ...draft.applicability, entities: event.target.checked ? [...draft.applicability.entities, { type: entity.type, key: entity.key }] : draft.applicability.entities.filter(item => item.type !== entity.type || item.key !== entity.key) } })} />{entity.name} ({entity.type})</label>)}</div>}
      {draft.applicability.entities.filter(ref => !options.some(entity => entity.type === ref.type && entity.key === ref.key)).map(ref => <div key={`${ref.type}:${ref.key}`} className="flex items-center gap-2 text-panel"><span>{ref.key} (unavailable)</span><Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, applicability: { ...draft.applicability, entities: draft.applicability.entities.filter(item => item.type !== ref.type || item.key !== ref.key) } })}>Remove</Button></div>)}
      <label htmlFor="context-conditions" className="text-panel">Conditions or exceptions</label>
      <Textarea id="context-conditions" disabled={draft.applicability.status !== "scoped"} value={draft.applicability.conditions ?? ""} onChange={event => setDraft({ ...draft, applicability: { ...draft.applicability, conditions: event.target.value || null } })} />
      <p className="text-panel text-muted-foreground">Unspecified means the evidence has not established where this knowledge applies. Saving creates a revision.</p>
      {save.error && <p role="alert" className="text-panel text-destructive">{save.error}</p>}
      {outcome && <p role="status" className="text-panel text-muted-foreground">{outcome}</p>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={save.isPending || (draft.applicability.status === "scoped" && !draft.applicability.entities.length && !draft.applicability.conditions?.trim())}>Save context</Button><Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
    </fieldset>
  </form>;
}
