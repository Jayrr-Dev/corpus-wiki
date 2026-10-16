"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queries";
import { CONTACT_KINDS, CONTACT_LABELS, type ContactKind, type PersonContact, type StakeholderCard } from "@/lib/stakeholders/cards";
import { rewriteStakeholderCard, savePersonContacts, setOurOrganization, setStakeholderHidden } from "@/lib/server-actions/stakeholders";
import { toast } from "sonner";

// "…" MENU FOR ONE CARD: open (card, entity) | edit (contacts, rewrite, our organization) | hide
export function StakeholderMenu({ card }: { card: StakeholderCard }) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.table("entity_profiles") });
  const act = (run: () => Promise<{ ok: true } | { ok: false; error: string }>) => async () => {
    const result = await run();
    if (!result.ok) toast.error(result.error);
    refresh();
  };
  return (
    <RowMenu label={card.name} items={[
      { label: "Open card", href: `/stakeholders/${card.entityId}` },
      { label: "Open entity", href: `/entities/${card.entityId}` },
      { label: "Edit contacts", separatorBefore: true, body: (close) => <ContactsForm card={card} close={() => { refresh(); close(); }} /> },
      { label: "Rewrite card", run: () => void act(() => rewriteStakeholderCard(card.entityId))() },
      card.isOurs
        ? { label: "Unset as our organization", run: () => void act(() => setOurOrganization(null))() }
        : { label: "Set as our organization", run: () => void act(() => setOurOrganization(card.entityId))() },
      card.hidden
        ? { label: "Show on Stakeholders", separatorBefore: true, run: () => void act(() => setStakeholderHidden(card.entityId, false))() }
        : { label: "Hide from Stakeholders", isDestructive: true, run: () => void act(() => setStakeholderHidden(card.entityId, true))() },
    ]} />
  );
}

// CONTACTS A PERSON ADDS: kept apart from the ones found in sources, never overwritten
export function ContactsForm({ card, close }: { card: StakeholderCard; close: () => void }) {
  const [rows, setRows] = useState<PersonContact[]>(card.personContacts.length ? card.personContacts : [{ kind: "email", value: "", label: null }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, patch: Partial<PersonContact>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const save = async () => {
    setSaving(true);
    const result = await savePersonContacts(card.entityId, rows);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    close();
  };
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <DialogTitle>Edit contacts</DialogTitle>
      <DialogDescription>{card.name}. Contacts you add here stay when the card is rewritten; contacts found in sources are listed on the card separately.</DialogDescription>
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="grid grid-cols-[7.5rem_1fr_8rem_auto] items-center gap-2">
            <select aria-label="Kind" value={row.kind} onChange={(event) => update(index, { kind: event.target.value as ContactKind })}
              className="h-8 rounded-md border bg-background px-2 text-panel">
              {CONTACT_KINDS.map((kind) => <option key={kind} value={kind}>{CONTACT_LABELS[kind]}</option>)}
            </select>
            <Input aria-label="Value" value={row.value} onChange={(event) => update(index, { value: event.target.value })} placeholder={row.kind === "person" ? "Name" : "Value"} maxLength={200} />
            <Input aria-label="Label" value={row.label ?? ""} onChange={(event) => update(index, { label: event.target.value || null })} placeholder="Label (optional)" maxLength={80} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { kind: "email", value: "", label: null }])}>Add contact</Button>
      {error && <p role="alert" className="text-panel text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
