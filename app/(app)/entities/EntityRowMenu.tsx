"use client";

import { useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { RetireForm } from "@/components/actions/RetireForm";
import { buildRetireEntity, buildUpdateEntity } from "@/components/actions/buildCatalog";
import { useSubmitEdit } from "@/components/actions/useSubmitEdit";
import { RowMenu, type RowMenuItem } from "@/components/row-menu/RowMenu";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/database/types";

type Entity = Tables<"entities">;

// "…" MENU FOR ONE ENTITY: open, edit or retire it (a retired one can only be opened)
export function EntityRowMenu({ entity }: { entity: Entity }) {
  const edits: RowMenuItem[] = [
    { label: "Edit", body: (close) => <EditEntityForm entity={entity} onDone={close} /> },
    {
      label: "Retire",
      isDestructive: true,
      body: (close) => (
        <RetireForm
          title={`Retire “${entity.name}”?`}
          description="The AI stops filing new knowledge under it. Units about it keep their link. Undo it from Changes."
          build={(reason) => buildRetireEntity(entity.id, reason)}
          onDone={close}
        />
      ),
    },
  ];
  return <RowMenu label={entity.name} items={[{ label: "Open", href: `/entities/${entity.id}` }, ...(entity.retired_at ? [] : edits)]} />;
}

// EDIT: name and aliases (type and key stay: earlier actions name the entity by them)
function EditEntityForm({ entity, onDone }: { entity: Entity; onDone: () => void }) {
  const [name, setName] = useState(entity.name);
  const [aliases, setAliases] = useState(entity.aliases.join(", "));
  const edit = useSubmitEdit(onDone);
  return (
    <DialogForm
      title="Edit entity"
      description={`Its type (${entity.type}) and key (${entity.key}) stay the same.`}
      submitLabel="Save"
      isPending={edit.isPending}
      error={edit.error}
      isDisabled={!name.trim()}
      onSubmit={() => edit.submit(buildUpdateEntity(entity.id, name, aliases))}
    >
      <FormRow htmlFor="edit-entity-name" label="Name">
        <Input id="edit-entity-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormRow>
      <FormRow htmlFor="edit-entity-aliases" label="Aliases (comma separated)">
        <Input id="edit-entity-aliases" value={aliases} onChange={(event) => setAliases(event.target.value)} />
      </FormRow>
    </DialogForm>
  );
}
