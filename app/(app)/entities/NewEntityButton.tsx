"use client";

import { useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { NewButton } from "@/components/actions/NewButton";
import { buildCreateEntity, type NewEntityValues } from "@/components/actions/buildCreate";
import { useSubmitEdit } from "@/components/actions/useSubmitEdit";
import { Input } from "@/components/ui/input";

// NEW ENTITY: a create_entity action through Change control (undo it from Changes)
export function NewEntityButton() {
  return <NewButton label="New entity">{(close) => <NewEntityForm onDone={close} />}</NewButton>;
}

// FORM: name, type and aliases; the key is made from the name
function NewEntityForm({ onDone }: { onDone: () => void }) {
  const [values, setValues] = useState<NewEntityValues>({ name: "", type: "", aliases: "" });
  const edit = useSubmitEdit(onDone);
  const set = (key: keyof NewEntityValues) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));
  return (
    <DialogForm
      title="New entity"
      description="A real thing knowledge can be about: a project, a person, a product."
      submitLabel="Create"
      isPending={edit.isPending}
      error={edit.error}
      isDisabled={!values.name.trim() || !values.type.trim()}
      onSubmit={() => edit.submit(buildCreateEntity(values))}
    >
      <FormRow htmlFor="entity-name" label="Name">
        <Input id="entity-name" value={values.name} onChange={set("name")} required />
      </FormRow>
      <FormRow htmlFor="entity-type" label="Type">
        <Input id="entity-type" value={values.type} onChange={set("type")} placeholder="project, person, team…" required />
      </FormRow>
      <FormRow htmlFor="entity-aliases" label="Aliases (comma separated)">
        <Input id="entity-aliases" value={values.aliases} onChange={set("aliases")} />
      </FormRow>
    </DialogForm>
  );
}
