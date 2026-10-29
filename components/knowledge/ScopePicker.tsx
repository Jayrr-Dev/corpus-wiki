"use client";

import { ChevronLeft } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { articleGroups, entityGroups, type ScopeGroup, topicGroups } from "@/lib/knowledge/scopeGroups";
import { SCOPE_KIND_LABELS, SCOPE_KINDS, type Scope, type ScopeKind, type ScopeOptions } from "@/lib/knowledge/scopeTypes";

// SCOPE PICKER: what a Study set, video or doc set is built from. A tab per kind (Topic, Article,
// Entity, Glossary), then a card (a topic, or an entity type) and a choice inside it. Glossary
// starts on the whole glossary; a topic card narrows it to that topic's terms.
// `value` is null until the pick is complete. Options come from loadScopeOptions (lib/knowledge/scope.ts).
// The Glossary tab's first card: no topic
const WHOLE_GLOSSARY = "glossary:all";

export function ScopePicker({ options, value, onChange, disabled }: {
  options: ScopeOptions;
  value: Scope | null;
  onChange: (scope: Scope | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [kind, setKind] = useState<ScopeKind>(value?.kind ?? "topic");

  const chooseKind = (next: ScopeKind) => {
    if (next === kind) return;
    setKind(next);
    onChange(next === "glossary" ? { kind: "glossary" } : null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = SCOPE_KINDS[(SCOPE_KINDS.indexOf(kind) + step + SCOPE_KINDS.length) % SCOPE_KINDS.length];
    if (!next || !step) return;
    event.preventDefault();
    chooseKind(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  };
  const items = kind === "glossary" ? options.topic : options[kind];
  const selected = value?.kind !== kind ? "" : value.kind === "glossary" ? value.id ?? WHOLE_GLOSSARY : value.id;
  const noun = SCOPE_KIND_LABELS[kind].toLowerCase();

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Source" onKeyDown={onKeyDown} className="flex gap-1 border-b">
        {SCOPE_KINDS.map((item) => {
          const active = kind === item;
          return (
            <button
              key={item}
              id={`${id}-${item}-tab`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${id}-panel`}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => chooseKind(item)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-panel transition-colors disabled:opacity-50", active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {SCOPE_KIND_LABELS[item]}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${kind}-tab`}>
        <GroupCards
          key={kind}
          groups={kind === "glossary" ? [{ label: "Whole glossary", rows: [{ id: WHOLE_GLOSSARY, name: "Whole glossary", depth: 0 }] }, ...topicGroups(items)]
            : kind === "topic" ? topicGroups(items) : kind === "article" ? articleGroups(items) : entityGroups(items)}
          noun={noun}
          backLabel={kind === "entity" ? "All types" : "All topics"}
          selected={selected}
          disabled={disabled}
          onPick={(pickedId) => onChange(kind === "glossary" ? { kind, id: pickedId === WHOLE_GLOSSARY ? null : pickedId } : { kind, id: pickedId })}
        />
      </div>
    </div>
  );
}

// GROUP CARDS: a card per group (a top-level topic, an entity type); a card opens its rows
// as an indented tree to pick from. A card holding a single choice is picked straight away.
function GroupCards({ groups, noun, backLabel, selected, disabled, onPick }: {
  groups: ScopeGroup[];
  noun: string;
  backLabel: string;
  selected: string;
  disabled?: boolean;
  onPick: (id: string) => void;
}) {
  const selectedGroup = groups.find((group) => group.rows.some((row) => row.id === selected));
  // opens on the picked choice's card, so reopening the form shows where the pick sits
  const [open, setOpen] = useState<string | null>(selectedGroup && !onlyChoice(selectedGroup) ? selectedGroup.label : null);
  const group = groups.find((item) => item.label === open);

  if (!groups.length) return <p className="text-panel text-muted-foreground">No {noun === "entity" ? "entities" : `${noun}s`} yet.</p>;

  if (!group) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {groups.map((item) => {
          const picked = item === selectedGroup;
          const only = onlyChoice(item);
          return (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              aria-pressed={picked}
              onClick={() => (only ? onPick(only) : setOpen(item.label))}
              className={cn("flex min-h-12 items-center justify-center rounded-lg border px-3 py-2 text-center text-panel font-medium transition-colors hover:bg-accent disabled:opacity-50", picked ? "border-foreground bg-accent" : "border-border")}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-panel">
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen(null)}>
          <ChevronLeft />{backLabel}
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="truncate font-medium">{group.label}</span>
      </div>
      <div role="radiogroup" aria-label={group.label} className="flex max-h-64 flex-col overflow-y-auto rounded-lg border py-1">
        {group.rows.map((row, index) => {
          const indent = (
            <>
              <span aria-hidden className="w-(--indent) shrink-0" />
              {row.depth ? <span aria-hidden className="text-faint">└</span> : null}
            </>
          );
          const style = { "--indent": `${row.depth * 1.25}rem` } as CSSProperties;
          if (!row.id) {
            return <div key={`heading-${index}`} style={style} className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{indent}{row.name}</div>;
          }
          const rowId = row.id;
          const picked = rowId === selected;
          return (
            <button
              key={rowId}
              type="button"
              role="radio"
              aria-checked={picked}
              disabled={disabled}
              onClick={() => onPick(rowId)}
              style={style}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 text-left text-panel transition-colors hover:bg-accent disabled:opacity-50", picked && "bg-accent font-medium")}
            >
              {indent}{row.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The card's id when it holds exactly one choice and nothing else
function onlyChoice(group: ScopeGroup): string | null {
  return group.rows.length === 1 ? group.rows[0]?.id ?? null : null;
}
