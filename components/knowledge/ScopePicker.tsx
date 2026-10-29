"use client";

import { useId, useState } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SCOPE_KIND_LABELS, SCOPE_KINDS, type Scope, type ScopeKind, type ScopeOptions } from "@/lib/knowledge/scopeTypes";

// SCOPE PICKER: what a Study set, video or doc set is built from. Pick a kind (Topic, Article,
// Entity, Glossary), then the topic, article or entity; Glossary needs nothing more.
// `value` is null until the pick is complete. Options come from loadScopeOptions (lib/knowledge/scope.ts).
export function ScopePicker({ options, value, onChange, disabled }: {
  options: ScopeOptions;
  value: Scope | null;
  onChange: (scope: Scope | null) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const [kind, setKind] = useState<ScopeKind>(value?.kind ?? "topic");

  const chooseKind = (next: ScopeKind) => {
    setKind(next);
    onChange(next === "glossary" ? { kind: "glossary" } : null);
  };
  const items = kind === "glossary" ? [] : options[kind];
  const selected = value && value.kind === kind && value.kind !== "glossary" ? value.id : "";

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Source" className="flex flex-wrap gap-x-5 gap-y-2">
        {SCOPE_KINDS.map((item) => (
          <label key={item} className="flex items-center gap-2 text-panel">
            <input type="radio" name={name} className="accent-link" checked={kind === item} disabled={disabled} onChange={() => chooseKind(item)} />
            <span className="font-medium">{SCOPE_KIND_LABELS[item]}</span>
          </label>
        ))}
      </div>
      {kind === "glossary" ? null : (
        <NativeSelect
          aria-label={SCOPE_KIND_LABELS[kind]}
          className="w-full"
          value={selected}
          disabled={disabled || items.length === 0}
          onChange={(event) => onChange(event.target.value ? { kind, id: event.target.value } : null)}
        >
          <NativeSelectOption value="">{items.length ? `Choose ${SCOPE_KIND_LABELS[kind].toLowerCase()}…` : `No ${SCOPE_KIND_LABELS[kind].toLowerCase()}s yet.`}</NativeSelectOption>
          {items.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}
        </NativeSelect>
      )}
    </div>
  );
}
