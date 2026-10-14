"use client";

import { useState } from "react";
import { ErrorNote, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CommitResult } from "@/lib/change-control/types";
import type { UnitSummary } from "@/lib/queries/screens";
import { ActionFields } from "./ActionFields";
import type { ActionMode, ActionTarget } from "./buildAction";
import { useActionForm } from "./useActionForm";

// =====================================================================
// ACTION DIALOG: the one form for a person's typed edits to a unit.
// It builds a typed action and sends it through submitEdit (Change
// control); it never writes a table. "Delete" is Retire.
// =====================================================================

// WORDS PER MODE
const COPY: Record<ActionMode, { button: string; title: string; description: string }> = {
  revise: { button: "Revise", title: "Revise unit", description: "Saves a new revision; the old one stays in history." },
  retire: { button: "Retire", title: "Retire unit", description: "Marks the unit as no longer current. Nothing is deleted." },
  link: { button: "Link", title: "Link to another unit", description: "Adds a typed relationship from this unit." },
  set_status: { button: "Set status", title: "Set epistemic status", description: "Changes how certain this unit is." },
};

export type ActionDialogProps = { mode: ActionMode; unit: UnitSummary };

// DIALOG + TRIGGER BUTTON for one mode
export function ActionDialog({ mode, unit }: ActionDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {COPY[mode].button}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {isOpen ? <ActionForm mode={mode} unit={unit} onDone={() => setIsOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// The unit as the form sees it (the revision the person is looking at)
function toTarget(unit: UnitSummary): ActionTarget {
  return { id: unit.id, currentRevisionId: unit.current_revision_id, content: unit.content, epistemicStatus: unit.epistemic_status };
}

// FORM: fields, errors, the commit outcome and the buttons
function ActionForm({ mode, unit, onDone }: ActionDialogProps & { onDone: () => void }) {
  const form = useActionForm(mode, toTarget(unit), onDone);
  return (
    <form onSubmit={form.submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{COPY[mode].title}</DialogTitle>
        <DialogDescription>{COPY[mode].description}</DialogDescription>
      </DialogHeader>
      <ActionFields mode={mode} form={form} unitId={unit.id} />
      <ErrorNote error={form.error} />
      <CommitOutcome outcome={form.outcome} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {form.outcome ? "Close" : "Cancel"}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={form.isPending || Boolean(form.outcome)}>
          {form.isPending ? "Sending…" : COPY[mode].button}
        </Button>
      </DialogFooter>
    </form>
  );
}

// MODES OFFERED: a retired unit can only be linked (its history is final)
const CURRENT_MODES: readonly ActionMode[] = ["revise", "retire", "link", "set_status"];
const RETIRED_MODES: readonly ActionMode[] = ["link"];

// UNIT ACTION BUTTONS: one ActionDialog per edit the unit allows
export function UnitActionButtons({ unit }: { unit: UnitSummary }) {
  const modes = unit.retired_at ? RETIRED_MODES : CURRENT_MODES;
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map((mode) => (
        <ActionDialog key={mode} mode={mode} unit={unit} />
      ))}
    </div>
  );
}

// OUTCOME when Change control did not simply apply the edit
function CommitOutcome({ outcome }: { outcome: CommitResult | null }) {
  if (!outcome) return null;
  const isRejected = outcome.status === "rejected";
  return (
    <p className="flex items-center gap-2 text-panel">
      <StatusDot tone={isRejected ? "failed" : "needs-you"} />
      <span>{isRejected ? "The checks rejected this edit." : `${outcome.exceptions} part(s) wait in Exceptions.`}</span>
      <TextLink href={`/changes/${outcome.changeSetId}`}>Open change</TextLink>
    </p>
  );
}
