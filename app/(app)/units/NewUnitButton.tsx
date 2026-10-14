"use client";

import { useState } from "react";
import { toDateInputValue } from "@/app/(app)/_lib/format";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { NewButton } from "@/components/actions/NewButton";
import { enumOptions, OptionSelect } from "@/components/actions/OptionSelect";
import { buildAddClaim, type NewClaimValues } from "@/components/actions/buildCreate";
import { useSubmitEdit } from "@/components/actions/useSubmitEdit";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Constants } from "@/lib/database/types";
import { useDomains, useEntities } from "@/lib/queries";

// ENUM OPTIONS (from the generated database constants)
const KIND_OPTIONS = enumOptions(Constants.public.Enums.unit_kind);
const STATUS_OPTIONS = enumOptions(Constants.public.Enums.epistemic_status);

// Entity select values carry the natural key the add_claim action names ("type:key")
const ENTITY_SEPARATOR = ":";

// NEW UNIT: an add_claim action through Change control (undo it from Changes)
export function NewUnitButton() {
  return <NewButton label="New unit">{(close) => <NewUnitForm onDone={close} />}</NewButton>;
}

// FORM VALUES before they become an action (selects hold strings)
type FormValues = Omit<NewClaimValues, "entity"> & { entityRef: string };

// FORM: the claim, its kind and status, the date it holds from, and optionally what it is about and where it belongs
function NewUnitForm({ onDone }: { onDone: () => void }) {
  const [values, setValues] = useState<FormValues>(() => ({
    content: "",
    kind: "fact",
    epistemicStatus: "established",
    validFrom: toDateInputValue(Date.now()),
    entityRef: "",
    domainPath: null,
  }));
  const edit = useSubmitEdit(onDone);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const submit = () => edit.submit(buildAddClaim({ ...values, entity: parseEntityRef(values.entityRef) }));
  return (
    <DialogForm
      title="New unit"
      description="One atomic claim. It is saved as its first revision."
      submitLabel="Create"
      isPending={edit.isPending}
      error={edit.error}
      isDisabled={!values.content.trim() || !values.validFrom}
      onSubmit={submit}
    >
      <FormRow htmlFor="unit-content" label="Content">
        <Textarea id="unit-content" value={values.content} onChange={(event) => set("content", event.target.value)} required />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow htmlFor="unit-kind" label="Kind">
          <OptionSelect id="unit-kind" label="Kind" value={values.kind} options={KIND_OPTIONS} onChange={(value) => set("kind", toKind(value))} className="w-full" />
        </FormRow>
        <FormRow htmlFor="unit-status" label="Epistemic status">
          <OptionSelect id="unit-status" label="Epistemic status" value={values.epistemicStatus} options={STATUS_OPTIONS} onChange={(value) => set("epistemicStatus", toStatus(value))} className="w-full" />
        </FormRow>
      </div>
      <FormRow htmlFor="unit-valid-from" label="True from">
        <Input id="unit-valid-from" type="date" value={values.validFrom} onChange={(event) => set("validFrom", event.target.value)} required />
      </FormRow>
      <AboutFields values={values} set={set} />
    </DialogForm>
  );
}

type AboutFieldsProps = { values: FormValues; set: <K extends keyof FormValues>(key: K, value: FormValues[K]) => void };

// ABOUT: the entity it is about and the domain it belongs to (both optional)
function AboutFields({ values, set }: AboutFieldsProps) {
  const { data: entities = [] } = useEntities();
  const { data: domains = [] } = useDomains();
  const entityOptions = entities
    .filter((entity) => !entity.merged_into_id && !entity.retired_at)
    .map((entity) => ({ value: `${entity.type}${ENTITY_SEPARATOR}${entity.key}`, label: `${entity.name} (${entity.type})` }));
  const domainOptions = domains.filter((domain) => !domain.retired_at).map((domain) => ({ value: domain.path, label: domain.path }));
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormRow htmlFor="unit-entity" label="About">
        <OptionSelect id="unit-entity" label="About" value={values.entityRef} options={entityOptions} emptyLabel="No entity" onChange={(value) => set("entityRef", value)} className="w-full" />
      </FormRow>
      <FormRow htmlFor="unit-domain" label="Domain">
        <OptionSelect id="unit-domain" label="Domain" value={values.domainPath ?? ""} options={domainOptions} emptyLabel="No domain" onChange={(value) => set("domainPath", value || null)} className="w-full" />
      </FormRow>
    </div>
  );
}

// "project:alpha" -> { type, key }; split at the first separator (a type never holds one)
function parseEntityRef(ref: string): NewClaimValues["entity"] {
  const at = ref.indexOf(ENTITY_SEPARATOR);
  return at > 0 ? { type: ref.slice(0, at), key: ref.slice(at + 1) } : null;
}

// SELECT VALUE -> ENUM (a guard instead of a cast; unknown values fall back)
function toKind(value: string): NewClaimValues["kind"] {
  return Constants.public.Enums.unit_kind.find((kind) => kind === value) ?? "fact";
}

function toStatus(value: string): NewClaimValues["epistemicStatus"] {
  return Constants.public.Enums.epistemic_status.find((status) => status === value) ?? "established";
}
