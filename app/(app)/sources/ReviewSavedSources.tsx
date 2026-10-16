"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/actions/useServerAction";
import { useDomains, useEntities } from "@/lib/queries";
import { reviewSavedExternalSources } from "@/lib/server-actions/externalReview";
import { typeIsOrganization } from "@/lib/knowledge/entityTypes";

export function ReviewSavedSources() {
  const [chosen, setChosen] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const entities = useEntities();
  const domains = useDomains();
  const rootOwners = new Set((domains.data ?? []).filter((domain) => !domain.parent_id && !domain.retired_at).map((domain) => domain.context_entity_id));
  const projects = (entities.data ?? []).filter((entity) => rootOwners.has(entity.id) && !entity.retired_at && (typeIsOrganization(entity.type) || entity.type === "project"));
  const entityId = chosen ?? (projects.length === 1 ? projects[0]!.id : "");
  const review = useServerAction(reviewSavedExternalSources, { progress: { title: "Reviewing saved external sources…", detail: "Checking each source against the original project evidence. Rejected sources will be archived." } });
  const run = async () => {
    setSummary(null);
    const result = await review.run(entityId);
    if (result.ok) setSummary(`${result.approved} approved · ${result.archived} archived · ${result.failed} could not be reviewed${result.skipped ? ` · ${result.skipped} belong to another or unknown project` : ""}`);
  };
  return <div className="space-y-2 rounded-md border p-3">
    <p className="text-panel text-muted-foreground">Review earlier imports against a project. Rejected sources are archived and remain recoverable; their cited claims are marked stale.</p>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Project context for source review" value={entityId} onChange={(event) => setChosen(event.target.value)} disabled={review.isPending} className="rounded-md border bg-background px-3 py-2 text-panel">
        <option value="">Choose project context</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <Button variant="outline" size="sm" disabled={!entityId || review.isPending} onClick={() => void run()}>Review saved sources</Button>
    </div>
    {summary && <p className="text-panel" role="status">{summary}</p>}
    {review.error && <p className="text-panel text-failed" role="alert">{review.error}</p>}
  </div>;
}
