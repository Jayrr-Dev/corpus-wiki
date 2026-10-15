"use client";

import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { FormButtons } from "@/app/(app)/_pages/PageForms";
import { FormRow } from "@/components/actions/FormRow";
import { enumOptions, OptionSelect } from "@/components/actions/OptionSelect";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { UnitKind } from "@/lib/ai/types";
import { Constants, type Tables } from "@/lib/database/types";
import { useEntities } from "@/lib/queries";
import { createSection } from "@/lib/server-actions/pages";

// KIND CHOICES (from the database enum)
const KIND_OPTIONS = enumOptions(Constants.public.Enums.unit_kind);

// ADD SECTION: a button on the page header that opens the form
export function AddSectionDialog({ page }: { page: Tables<"pages"> }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Add section
        </Button>
      </DialogTrigger>
      <DialogContent>{isOpen ? <AddSectionForm page={page} onDone={() => setIsOpen(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

// FORM: title, which entity's claims it shows (the page's own by default), and optionally one kind
function AddSectionForm({ page, onDone }: { page: Tables<"pages">; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [entityId, setEntityId] = useState(page.entity_id ?? "");
  const [kind, setKind] = useState("");
  const create = useServerAction(createSection, { progress: { title: `Adding a section to “${page.title}”`, detail: "Writing the section…" } });
  const entityOptions = (useEntities().data ?? []).map((entity) => ({ value: entity.id, label: entity.name }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await create.run({ pageId: page.id, title, entityId, kind: (kind || null) as UnitKind | null });
    if (result.ok) onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add section</DialogTitle>
        <DialogDescription>The section is written from the claims about what you pick, and stays up to date.</DialogDescription>
      </DialogHeader>
      <FormRow htmlFor="section-title" label="Title">
        <Input id="section-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FormRow>
      <FormRow htmlFor="section-entity" label="About">
        <OptionSelect id="section-entity" label="Entity" value={entityId} options={entityOptions} emptyLabel="Pick an entity" onChange={setEntityId} className="w-full" />
      </FormRow>
      <FormRow htmlFor="section-kind" label="Show">
        <OptionSelect id="section-kind" label="Kind" value={kind} options={KIND_OPTIONS} emptyLabel="Every kind of claim" onChange={setKind} className="w-full" />
      </FormRow>
      <ErrorNote error={create.error} />
      <FormButtons isPending={create.isPending} submitLabel="Add" isDisabled={!title.trim() || !entityId} />
    </form>
  );
}
