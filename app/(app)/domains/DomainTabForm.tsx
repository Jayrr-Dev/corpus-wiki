"use client";

import { useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDomains } from "@/lib/queries";
import { saveDomainTab } from "@/lib/server-actions/domainTabs";
import type { Row } from "@/lib/queries";

export function DomainTabForm({ tab, onDone }: { tab?: Row<"domain_tabs">; onDone: (id: string) => void }) {
  const [name, setName] = useState(tab?.name ?? "");
  const [description, setDescription] = useState(tab?.description ?? "");
  const [rootIds, setRootIds] = useState(tab?.root_ids ?? []);
  const domains = useDomains();
  const save = useServerAction(saveDomainTab);
  return <DialogForm title={tab ? "Edit domain tab" : "New domain tab"} description="Group root domains and describe what belongs here. Subdomains follow their root. Organization context and root approval still apply." submitLabel={tab ? "Save" : "Create tab"} isPending={save.isPending} error={save.error} isDisabled={!name.trim() || !description.trim() || domains.isPending || domains.isError} onSubmit={async () => {
    const result = await save.run({ id: tab?.id, name, description, rootIds });
    if (result.ok) onDone(result.id);
  }}>
    <FormRow htmlFor="tab-name" label="Name"><Input id="tab-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></FormRow>
    <FormRow htmlFor="tab-description" label="Which subjects belong in this tab?"><Textarea id="tab-description" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} placeholder="For example: psychology, personality systems and personal development." required /></FormRow>
    <p className="text-panel text-muted-foreground">This describes a navigation group. Source evidence determines ownership and whether a claim is internal policy or external guidance.</p>
    <fieldset className="space-y-2"><legend className="mb-2 text-panel font-medium">Root domains</legend><p className="text-panel text-muted-foreground">Selecting a root moves it into this tab. You can add roots later.</p>
      <div className="max-h-48 overflow-y-auto">{(domains.data ?? []).filter((domain) => !domain.parent_id && !domain.retired_at).map((domain) => <label key={domain.id} className="flex items-center gap-2 py-1 text-panel"><input type="checkbox" checked={rootIds.includes(domain.id)} onChange={(event) => setRootIds(event.target.checked ? [...rootIds, domain.id] : rootIds.filter((id) => id !== domain.id))} />{domain.name}</label>)}</div>
    </fieldset>
  </DialogForm>;
}
