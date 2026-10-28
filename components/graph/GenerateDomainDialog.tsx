"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PopoverDescription } from "@/components/ui/popover";
import { InfoPopover } from "@/components/standard/info-popover";
import { Tooltip } from "@/components/standard/tooltip";
import { useServerAction } from "@/components/actions/useServerAction";
import { applySelectionDomainPlan, suggestSelectionDomain } from "@/lib/server-actions/generateSelectionDomain";
import { dropClaimFromPlan, moveClaimInPlan, selectionGroupAction, selectionPlanHeadline, type SelectionDomainGroup, type SelectionDomainPlan, type SelectionGroupAction } from "@/lib/domains/selectionDomainPlan";

const ACTION_LABEL: Record<SelectionGroupAction, string> = {
  move: "Move",
  create: "Create domain",
  keep: "Keep",
};

export type GenerateClaim = { id: string; label: string; text: string };

function domainLeaf(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function domainParent(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join(" / ");
}

function planForGroup(plan: SelectionDomainPlan, group: SelectionDomainGroup): SelectionDomainPlan {
  const ids = new Set(group.unitIds);
  return {
    reason: plan.reason,
    claims: plan.claims.filter((claim) => ids.has(claim.id)),
    groups: [group],
  };
}

function PlanStep({
  group,
  domains,
  busy,
  applying,
  onView,
  onApply,
}: {
  group: SelectionDomainGroup;
  domains: string[][];
  busy: boolean;
  applying: boolean;
  onView: () => void;
  onApply: () => void;
}) {
  const action = selectionGroupAction(group, domains);
  const count = group.unitIds.length;
  const countLabel = count === 1 ? "1 claim" : `${count} claims`;
  const leaf = domainLeaf(group.destinationPath);
  const parent = domainParent(group.destinationPath);
  const applyButton = action === "keep" ? (
    <Tooltip content="These claims already sit in this domain.">
      <span>
        <Button type="button" size="sm" variant="outline" disabled>Apply</Button>
      </span>
    </Tooltip>
  ) : (
    <Button type="button" size="sm" disabled={busy} onClick={onApply}>{applying ? "Applying…" : "Apply"}</Button>
  );
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-faint uppercase">Recommended action</p>
          <p className="mt-1 font-medium">{ACTION_LABEL[action]}</p>
        </div>
        {applyButton}
      </div>
      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <div className="flex min-h-16 flex-1 flex-col items-center justify-center gap-2 rounded-md border px-3 py-3 text-center">
          <p className="font-medium">{countLabel}</p>
          <Button type="button" size="sm" variant="outline" onClick={onView}>View</Button>
        </div>
        <ArrowRight className="mx-auto size-4 shrink-0 rotate-90 text-faint sm:mx-0 sm:rotate-0" aria-hidden />
        <Tooltip content={group.destinationPath}>
          <div className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center rounded-md border px-3 py-3 text-center">
            <p className="font-medium">{leaf}</p>
            {parent ? <p className="max-w-full truncate text-panel text-faint">{parent}</p> : null}
          </div>
        </Tooltip>
      </div>
      <p className="mt-3 text-xs font-medium tracking-wide text-faint uppercase">Reason</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        <li className="text-panel">{group.why}</li>
      </ul>
    </li>
  );
}

export function GenerateDomainDialog({
  open,
  claims,
  extraSelected,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  claims: GenerateClaim[];
  extraSelected: number;
  onOpenChange: (open: boolean) => void;
  onApplied: (message: string) => void;
}) {
  const unitIds = claims.map((claim) => claim.id);
  const [preview, setPreview] = useState<SelectionDomainPlan | null>(null);
  const [viewPath, setViewPath] = useState<string | null>(null);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const suggest = useServerAction(suggestSelectionDomain, {
    progress: { title: "Generating a domain", detail: "Reading the selected claims and the domain tree…" },
    refreshTables: [],
  });
  const apply = useServerAction(applySelectionDomainPlan, {
    progress: { title: "Filing selected claims", detail: "Creating domains and moving claims…" },
  });
  const busy = suggest.isPending || apply.isPending;
  const claimDomains = new Map((preview?.claims ?? []).map((claim) => [claim.id, claim.domains]));
  const claimText = new Map(claims.map((claim) => [claim.id, claim]));
  const viewGroup = preview?.groups.find((group) => group.destinationPath === viewPath) ?? null;
  const canApplyAll = preview ? preview.groups.some((group) => selectionGroupAction(group, group.unitIds.map((id) => claimDomains.get(id) ?? [])) !== "keep") : false;
  const close = (value: boolean) => {
    if (busy) return;
    if (!value) {
      setPreview(null);
      setViewPath(null);
      setApplyingPath(null);
      suggest.reset();
      apply.reset();
    }
    onOpenChange(value);
  };
  const generate = async () => {
    setPreview(null);
    setViewPath(null);
    apply.reset();
    const result = await suggest.run(unitIds);
    if (result.ok) setPreview(result.plan);
  };
  const finish = (count: number, status: string, applied: number, total: number) => {
    setPreview(null);
    setViewPath(null);
    setApplyingPath(null);
    suggest.reset();
    apply.reset();
    onApplied(status === "applied" ? `${count === 1 ? "1 claim" : `${count} claims`} organized.` : `${applied} of ${total} actions applied. Review Changes or undo.`);
  };
  const revise = (next: SelectionDomainPlan) => {
    setPreview(next.groups.length > 0 ? next : null);
    if (!next.groups.some((group) => group.destinationPath === viewPath)) setViewPath(null);
  };
  const applyPlan = async (plan: SelectionDomainPlan, path: string) => {
    setApplyingPath(path);
    const result = await apply.run(plan);
    setApplyingPath(null);
    if (!result.ok || !preview) return;
    if (path === "all") {
      finish(plan.claims.length, result.status, result.applied, result.total);
      return;
    }
    const ids = new Set(plan.claims.map((claim) => claim.id));
    const rest = {
      ...preview,
      claims: preview.claims.filter((claim) => !ids.has(claim.id)),
      groups: preview.groups.filter((group) => group.destinationPath !== path),
    };
    if (rest.groups.length === 0) {
      finish(plan.claims.length, result.status, result.applied, result.total);
      return;
    }
    setPreview(rest);
  };
  return <>
    <Dialog open={open} onOpenChange={close}>
    <DialogContent
      className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
      showCloseButton={!busy}
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onInteractOutside={(event) => { if (busy || viewPath) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (busy || viewPath) event.preventDefault(); }}
    >
      <DialogHeader>
        <div className="flex items-center gap-2 pr-6">
          <DialogTitle>Generate domain</DialogTitle>
          <InfoPopover label="About generate domain">
            <PopoverDescription>The model reads the selected claims and the domain tree, then proposes where they should go.</PopoverDescription>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>It can make one new domain and file the selection there.</li>
              <li>It can move some claims into a domain that already fits.</li>
              <li>It can split the selection across more than one domain.</li>
              <li>Nothing changes until you apply. Claim text and links stay intact.</li>
              <li>Applying files each claim only in its destination. Other memberships are replaced.</li>
            </ul>
          </InfoPopover>
        </div>
        <DialogDescription className="sr-only">The model reads the selected claims and the domain tree, then proposes where they should go.</DialogDescription>
      </DialogHeader>
      {busy ? <p role="status" className="absolute top-2 right-2 flex size-7 items-center justify-center"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /><span className="sr-only">{suggest.isPending ? "Generating a domain" : "Filing claims"}</span></p> : null}
      <p className="text-panel">{unitIds.length === 1 ? "1 claim selected." : `${unitIds.length} claims selected.`}</p>
      {extraSelected > 0 ? <p className="text-panel text-muted-foreground">Only claims are filed. Anything else you selected stays put.</p> : null}
      {preview ? <div className="space-y-3">
        <p className="font-medium">{selectionPlanHeadline(preview.groups)}</p>
        <p className="whitespace-pre-wrap text-panel">{preview.reason}</p>
        <ul className="space-y-3">{preview.groups.map((group) => (
          <PlanStep
            key={group.destinationPath}
            group={group}
            domains={group.unitIds.map((id) => claimDomains.get(id) ?? [])}
            busy={busy}
            applying={applyingPath === group.destinationPath}
            onView={() => setViewPath(group.destinationPath)}
            onApply={() => void applyPlan(planForGroup(preview, group), group.destinationPath)}
          />
        ))}</ul>
      </div> : null}
      {(suggest.error || apply.error) ? <p role="alert" className="text-panel text-destructive">{suggest.error || apply.error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant={preview ? "outline" : "default"} disabled={busy || unitIds.length === 0} onClick={() => void generate()}>{suggest.isPending ? "Generating…" : preview ? "Generate again" : "Generate"}</Button>
        {preview ? <Button disabled={busy || !canApplyAll} onClick={() => void applyPlan(preview, "all")}>{applyingPath === "all" ? "Applying…" : "Apply all"}</Button> : null}
      </div>
    </DialogContent>
    </Dialog>
    <Dialog open={viewGroup !== null} onOpenChange={(value) => { if (!value && !busy) setViewPath(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <div className="flex items-center gap-2 pr-6">
            <DialogTitle>{viewGroup ? (viewGroup.unitIds.length === 1 ? "1 claim" : `${viewGroup.unitIds.length} claims`) : "Claims"}</DialogTitle>
            <InfoPopover label="About these claims">
              <PopoverDescription>These are the claims in this step. Nothing is filed until you apply.</PopoverDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Remove leaves a claim out. It stays in its current domain.</li>
                <li>Move sends it to another step in this plan.</li>
              </ul>
            </InfoPopover>
          </div>
          <DialogDescription className="sr-only">These are the claims in this step. Remove one to leave it out, or move it to another step.</DialogDescription>
        </DialogHeader>
        {viewGroup ? <ul className="space-y-3">
          {viewGroup.unitIds.map((id) => {
            const claim = claimText.get(id);
            const others = preview?.groups.filter((group) => group.destinationPath !== viewGroup.destinationPath) ?? [];
            return (
              <li key={id} className="rounded-md border p-3">
                <p className="font-medium">{claim?.label || "Claim"}</p>
                {claim?.text ? <p className="mt-1 whitespace-pre-wrap text-panel text-muted-foreground">{claim.text}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {others.length > 0 ? (
                    <select
                      aria-label={`Move ${claim?.label || "claim"}`}
                      className="rounded border bg-background px-2 py-1 text-panel"
                      value=""
                      disabled={busy}
                      onChange={(event) => {
                        const path = event.target.value;
                        if (!path || !preview) return;
                        revise(moveClaimInPlan(preview, id, path));
                      }}
                    >
                      <option value="">Move to…</option>
                      {others.map((group) => <option key={group.destinationPath} value={group.destinationPath}>{domainLeaf(group.destinationPath)}</option>)}
                    </select>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { if (preview) revise(dropClaimFromPlan(preview, id)); }}>Remove</Button>
                </div>
              </li>
            );
          })}
        </ul> : null}
      </DialogContent>
    </Dialog>
  </>;
}
