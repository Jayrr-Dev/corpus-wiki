"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerAction } from "@/components/actions/useServerAction";
import { suggestDomainTabs, applyDomainTabs } from "@/lib/server-actions/organizeDomainTabs";
import type { TabLayout, TabPlan } from "@/lib/domains/tabOrganization";

export function OrganizeTabsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [preview, setPreview] = useState<{ plan: TabPlan; snapshot: TabLayout } | null>(null);
  const suggest = useServerAction(suggestDomainTabs, { progress: { title: "Organizing domain tabs", detail: "Checking root subjects and saved knowledge…" }, refreshTables: [] });
  const apply = useServerAction(applyDomainTabs);
  const busy = suggest.isPending || apply.isPending;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Organize tabs</DialogTitle>
        <DialogDescription>Preview AI suggestions for grouping domains by subject. Knowledge and sources stay unchanged.</DialogDescription>
      </DialogHeader>
      {preview && <div className="space-y-3">
        <p className="whitespace-pre-wrap text-panel">{preview.plan.reason}</p>
        <ul className="space-y-3">{preview.plan.tabs.map((tab, index) => <li key={tab.id ?? `new-${index}`} className="rounded-md border p-3">
          <p className="font-medium">{tab.name}{!tab.id && <span className="ml-2 text-xs text-muted-foreground">New tab</span>}</p>
          <p className="text-panel text-muted-foreground">{tab.description}</p>
          <p className="mt-2 text-panel">{tab.rootIds.map(id => preview.snapshot.roots.find(root => root.id === id)?.name).join(", ") || "No active roots"}</p>
        </li>)}</ul>
      </div>}
      {(suggest.error || apply.error) && <p role="alert" className="text-panel text-destructive">{suggest.error || apply.error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={async () => {
          setPreview(null); apply.reset();
          const result = await suggest.run();
          if (result.ok) setPreview({ plan: result.plan, snapshot: result.snapshot });
        }}>{suggest.isPending ? "Reviewing…" : preview ? "Suggest again" : "Suggest tabs"}</Button>
        {preview && <Button disabled={busy} onClick={async () => {
          const result = await apply.run(preview.plan, preview.snapshot);
          if (result.ok) onOpenChange(false);
        }}>{apply.isPending ? "Applying…" : "Apply"}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
