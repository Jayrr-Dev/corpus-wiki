"use client";

import { useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { NewButton } from "@/components/actions/NewButton";
import { OptionSelect } from "@/components/actions/OptionSelect";
import { buildCreateDomain, domainPath } from "@/components/actions/buildCreate";
import { useSubmitEdit } from "@/components/actions/useSubmitEdit";
import { Input } from "@/components/ui/input";
import { useDomains } from "@/lib/queries";

// NEW DOMAIN BUTTON (page header): a root domain or one under any parent
export function NewDomainButton() {
  return <NewButton label="New domain">{(close) => <NewDomainForm parentPath={null} onDone={close} />}</NewButton>;
}

// FORM: a create_domain action through Change control; `parentPath` preselects the parent
export function NewDomainForm({ parentPath, onDone }: { parentPath: string | null; onDone: () => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState(parentPath ?? "");
  const { data: domains = [] } = useDomains();
  const edit = useSubmitEdit(onDone);
  const parentOptions = domains.filter((domain) => !domain.retired_at).map((domain) => ({ value: domain.path, label: domain.path }));
  return (
    <DialogForm
      title="New domain"
      description={`Creates ${domainPath(name || "…", parent || null)}. Undo it from Changes.`}
      submitLabel="Create"
      isPending={edit.isPending}
      error={edit.error}
      isDisabled={!name.trim() || name.includes("/")}
      onSubmit={() => edit.submit(buildCreateDomain(name, parent || null))}
    >
      <FormRow htmlFor="domain-name" label="Name">
        <Input id="domain-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormRow>
      <FormRow htmlFor="domain-parent" label="Parent">
        <OptionSelect id="domain-parent" label="Parent" value={parent} options={parentOptions} emptyLabel="None (a new root)" onChange={setParent} className="w-full" />
      </FormRow>
    </DialogForm>
  );
}
