"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { FormRow } from "@/components/actions/FormRow";
import { OptionSelect } from "@/components/actions/OptionSelect";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { reportTutorialAction } from "@/components/tutorial";
import { Input } from "@/components/ui/input";
import { useIsAdminMode } from "@/components/shell/useNavMode";
import { useEntities } from "@/lib/queries";
import { createPage } from "@/lib/server-actions/pages";

// CREATE PAGE: title plus an optional entity; opens the new page when it is made (admin only; hidden otherwise)
export function CreatePageDialog() {
  const isAdmin = useIsAdminMode();
  const [isOpen, setIsOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-tour="new-page">
          New page
        </Button>
      </DialogTrigger>
      <DialogContent>{isOpen ? <CreatePageForm /> : null}</DialogContent>
    </Dialog>
  );
}

// FORM: the fields and the createPage call
function CreatePageForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [entityId, setEntityId] = useState("");
  const create = useServerAction(createPage, { progress: { title: "Creating page", detail: "Building the page from saved knowledge…" } });
  const entityOptions = (useEntities().data ?? []).map((entity) => ({ value: entity.id, label: entity.name }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await create.run({ title, entityId: entityId || null });
    if (!result.ok) return;
    reportTutorialAction("page-created");
    router.push(`/p/${result.slug}`);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>New page</DialogTitle>
        <DialogDescription>With an entity, the page starts with an Overview written from its units.</DialogDescription>
      </DialogHeader>
      <FormRow htmlFor="page-title" label="Title">
        <Input id="page-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FormRow>
      <FormRow htmlFor="page-entity" label="About (optional)">
        <OptionSelect id="page-entity" label="Entity" value={entityId} options={entityOptions} emptyLabel="No entity" onChange={setEntityId} className="w-full" />
      </FormRow>
      <ErrorNote error={create.error} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={create.isPending || !title.trim()}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
