"use client";

import { useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { buildRenameDomain } from "@/components/actions/buildCatalog";
import { domainPath } from "@/components/actions/buildCreate";
import { useSubmitEdit } from "@/components/actions/useSubmitEdit";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/database/types";

type Domain = Tables<"domains">;

// The parent's path ("Projects/Alpha/Planning" -> "Projects/Alpha"), null for a root
function parentPathOf(domain: Domain): string | null {
  const cut = domain.path.lastIndexOf("/");
  return cut === -1 ? null : domain.path.slice(0, cut);
}

// RENAME DOMAIN: new name; its path and every path under it follow (undo from Changes)
export function RenameDomainForm({ domain, onDone }: { domain: Domain; onDone: () => void }) {
  const [name, setName] = useState(domain.name);
  const edit = useSubmitEdit(onDone);
  return (
    <DialogForm
      title="Rename domain"
      description={`Becomes ${domainPath(name || "…", parentPathOf(domain))}, and the domains under it follow.`}
      submitLabel="Rename"
      isPending={edit.isPending}
      error={edit.error}
      isDisabled={!name.trim() || name.includes("/") || name.trim() === domain.name}
      onSubmit={() => edit.submit(buildRenameDomain(domain.id, name))}
    >
      <FormRow htmlFor="rename-domain" label="Name">
        <Input id="rename-domain" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormRow>
    </DialogForm>
  );
}
