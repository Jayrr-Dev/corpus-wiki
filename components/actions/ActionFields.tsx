"use client";

import { useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Constants } from "@/lib/database/types";
import type { EpistemicStatus, RelationshipType } from "@/lib/ai/types";
import { useUnitSummaries } from "@/lib/queries/screens";
import type { ActionMode } from "./buildAction";
import { FormRow } from "./FormRow";
import { enumOptions, OptionSelect, type SelectOption } from "./OptionSelect";
import type { ActionForm } from "./useActionForm";

// ENUM OPTIONS (from the generated database constants)
const STATUS_OPTIONS = enumOptions(Constants.public.Enums.epistemic_status);
const RELATIONSHIP_OPTIONS = enumOptions(Constants.public.Enums.relationship_type);

type FieldsProps = { form: ActionForm; unitId: string };

// FIELDS FOR ONE MODE of the ActionDialog
export function ActionFields({ mode, form, unitId }: FieldsProps & { mode: ActionMode }) {
  if (mode === "revise") return <ReviseFields form={form} />;
  if (mode === "retire") return <RetireFields form={form} />;
  if (mode === "link") return <LinkFields form={form} unitId={unitId} />;
  return <StatusField form={form} emptyLabel="Pick a status" />;
}

// REVISE: new content, and optionally a new status
function ReviseFields({ form }: { form: ActionForm }) {
  return (
    <>
      <FormRow htmlFor="action-content" label="Content">
        <Textarea id="action-content" value={form.values.content} onChange={(event) => form.set("content", event.target.value)} />
      </FormRow>
      <StatusField form={form} emptyLabel="Keep current status" />
    </>
  );
}

// RETIRE: why it no longer holds (retiring never deletes; history stays)
function RetireFields({ form }: { form: ActionForm }) {
  return (
    <FormRow htmlFor="action-reason" label="Reason">
      <Textarea id="action-reason" value={form.values.reason} onChange={(event) => form.set("reason", event.target.value)} />
    </FormRow>
  );
}

// STATUS: one epistemic status
function StatusField({ form, emptyLabel }: { form: ActionForm; emptyLabel: string }) {
  return (
    <FormRow htmlFor="action-status" label="Epistemic status">
      <OptionSelect
        id="action-status"
        label="Epistemic status"
        value={form.values.epistemicStatus}
        options={STATUS_OPTIONS}
        emptyLabel={emptyLabel}
        onChange={(value) => form.set("epistemicStatus", toStatus(value))}
        className="w-full"
      />
    </FormRow>
  );
}

// LINK: relationship type and the other unit (this unit is the "from" side)
function LinkFields({ form, unitId }: FieldsProps) {
  const unitOptions = useOtherUnitOptions(unitId);
  return (
    <>
      <FormRow htmlFor="action-link-type" label="This unit…">
        <OptionSelect
          id="action-link-type"
          label="Relationship"
          value={form.values.relationshipType}
          options={RELATIONSHIP_OPTIONS}
          onChange={(value) => form.set("relationshipType", toRelationship(value))}
          className="w-full"
        />
      </FormRow>
      <FormRow htmlFor="action-link-unit" label="…this unit">
        <OptionSelect
          id="action-link-unit"
          label="Other unit"
          value={form.values.toUnitId}
          options={unitOptions}
          emptyLabel="Pick a unit"
          onChange={(value) => form.set("toUnitId", value)}
          className="w-full"
        />
      </FormRow>
    </>
  );
}

// Current units other than this one, labelled by their content
function useOtherUnitOptions(unitId: string): SelectOption[] {
  const { data: units = [] } = useUnitSummaries();
  return useMemo(
    () =>
      units
        .filter((unit) => unit.id !== unitId && !unit.retired_at)
        .map((unit) => ({ value: unit.id, label: truncate(unit.content, 90) })),
    [units, unitId],
  );
}

// SELECT VALUE -> ENUM (a guard instead of a cast; unknown values fall back)
function toStatus(value: string): EpistemicStatus | "" {
  return Constants.public.Enums.epistemic_status.find((status) => status === value) ?? "";
}

function toRelationship(value: string): RelationshipType {
  return Constants.public.Enums.relationship_type.find((type) => type === value) ?? "related_to";
}

// Shortens long content for a select option
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
