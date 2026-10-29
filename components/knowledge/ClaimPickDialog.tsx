"use client";

import { useEffect, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Scope } from "@/lib/knowledge/scopeTypes";

// CLAIM PICK DIALOG (Coverage: Custom): the claims of the chosen source, most central first, each with
// a check. Titles only. It opens on the current picks; Save returns the checked claim ids in list order.
export type PickableClaim = { unitId: string; title: string };

export function ClaimPickDialog({ open, onOpenChange, scope, picked, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  picked: readonly string[];
  onSave: (unitIds: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ClaimChecks scope={scope} picked={picked} onSave={(unitIds) => { onSave(unitIds); onOpenChange(false); }} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted with the dialog, so each opening loads the list and starts from the picks
function ClaimChecks({ scope, picked, onSave, onCancel }: {
  scope: Scope;
  picked: readonly string[];
  onSave: (unitIds: string[]) => void;
  onCancel: () => void;
}) {
  const [claims, setClaims] = useState<PickableClaim[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(picked));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ kind: scope.kind });
    if (scope.id) params.set("id", scope.id);
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/knowledge/claims?${params}`);
        const body = await response.json().catch(() => null) as { claims?: PickableClaim[]; error?: string } | null;
        if (!response.ok || !body?.claims) throw new Error(body?.error ?? "Could not load the claims.");
        if (active) setClaims(body.claims);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load the claims.");
      }
    })();
    return () => { active = false; };
  }, [scope.kind, scope.id]);

  const toggle = (unitId: string, on: boolean) => setChecked((current) => {
    const next = new Set(current);
    if (on) next.add(unitId); else next.delete(unitId);
    return next;
  });
  const chosen = (claims ?? []).filter((claim) => checked.has(claim.unitId)).map((claim) => claim.unitId);

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Custom claims</DialogTitle>
        <DialogDescription>Check the claims to use. Most central first.</DialogDescription>
      </DialogHeader>
      <ErrorNote error={error} />
      {!claims && !error ? <p role="status" className="text-panel text-muted-foreground">Loading claims…</p> : null}
      {claims && !claims.length ? <p className="text-panel text-muted-foreground">No claims in this source yet.</p> : null}
      {claims?.length ? (
        <>
          <div className="flex items-center gap-2 text-panel">
            <Button type="button" variant="ghost" size="sm" onClick={() => setChecked(new Set(claims.map((claim) => claim.unitId)))}>All</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setChecked(new Set())}>None</Button>
            <span className="ml-auto text-muted-foreground">{chosen.length} of {claims.length}</span>
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
            {claims.map((claim) => (
              <label key={claim.unitId} className="flex items-start gap-2 rounded px-1.5 py-1 text-panel hover:bg-accent">
                <input type="checkbox" className="accent-link mt-1" checked={checked.has(claim.unitId)} onChange={(event) => toggle(claim.unitId, event.target.checked)} />
                <span>{claim.title}</span>
              </label>
            ))}
          </div>
        </>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={!chosen.length} onClick={() => onSave(chosen)}>Save</Button>
      </DialogFooter>
    </div>
  );
}
