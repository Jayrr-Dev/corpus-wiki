"use client";
import { useRef, useState } from "react";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionHint } from "@/components/actions/ActionHint";
import { useServerAction } from "@/components/actions/useServerAction";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { updateDomains } from "@/lib/server-actions/domainDecider";
type DomainUpdateOptions = { focusedDomain?: string | null; relatedness?: number; showRelated?: boolean };

export function useDomainUpdate({ relatedness = 0.3, showRelated = true, focusedDomain = null }: DomainUpdateOptions = {}) {
  const action = useServerAction(updateDomains, { progress: { title: "Updating domains", detail: "Reviewing one domain with its claims, connections and nearby destinations..." } });
  const preview = useServerAction(updateDomains, { progress: false, refreshTables: [] });
  const stop = useRef(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const effectiveTarget = focusedDomain ?? "";
  const guidance = "";
  const busy = running || action.isPending;
  const run = async () => {
      stop.current = false;
      setRunning(true);
      const reviewed: string[] = [];
      let changes = 0;
      try {
        while (!stop.current) {
          setResult("Finding the next domain…");
          const next = await preview.run(guidance, { threshold: relatedness, show: showRelated }, reviewed, true, effectiveTarget);
          if (!next.ok) { setResult(`${changes} changes applied before review stopped.`); break; }
          if (!next.domain) { setResult(null); break; }
          if (stop.current) break;
          setResult(`Reviewing ${next.domain.split("/").at(-1)}…`);
          const outcome = await action.run(guidance, { threshold: relatedness, show: showRelated }, reviewed, false, effectiveTarget);
          if (!outcome.ok) { setResult(`Review stopped at ${next.domain}. ${changes} changes applied in this run. Earlier updates remain available to undo.`); break; }
          changes += outcome.changes;
          if (outcome.reviewKey) reviewed.push(outcome.reviewKey);
          setResult(outcome.exceptions ? "Review needed in Exceptions." : null);
          if (outcome.exceptions || !outcome.domain || effectiveTarget) break;
        }
      } finally {
        setRunning(false);
      }
  };
  return { run, busy, running, result, error: action.error ?? preview.error, stop: () => { stop.current = true; setResult("Stopping after this domain…"); } };
}

export function UpdateDomainsButton(options: DomainUpdateOptions) {
  const update = useDomainUpdate(options);
  return <div className="flex min-w-0 flex-col gap-1">
    <Button size="sm" variant="outline" className="justify-start" disabled={update.busy} onClick={update.run}>
      <Network size={14} />{update.running ? "Updating domains..." : "Update Domains"}
      <ActionHint>{options.focusedDomain ? `Update ${options.focusedDomain.split("/").at(-1)} and its children.` : "Update all domains using claims and connections."}</ActionHint>
    </Button>
    <DomainUpdateStatus update={update} />
  </div>;
}

export function DomainUpdateStatus({ update }: { update: ReturnType<typeof useDomainUpdate> }) {
  return <>
    {update.running && <Button size="sm" variant="outline" onClick={update.stop}>Stop after this domain</Button>}
    {update.result && <p role="status" className="break-words text-xs text-muted-foreground">{update.result}</p>}
    <ErrorNote error={update.error} />
  </>;
}
