"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PopoverDescription } from "@/components/ui/popover";
import { InfoPopover } from "@/components/standard/info-popover";
import { Tooltip } from "@/components/standard/tooltip";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useDomains } from "@/lib/queries";
import { useServerAction } from "@/components/actions/useServerAction";
import { organizeGraphSelection } from "@/lib/server-actions/graphNodes";
import { GenerateDomainDialog } from "./GenerateDomainDialog";

import { isContent, type GraphNode } from "@/lib/graph";

export function SelectionActions({ nodes, onClear }: { nodes: GraphNode[]; onClear: () => void }) {
  const [mode, setMode] = useState<"move" | "create" | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateClaims, setGenerateClaims] = useState<{ id: string; label: string; text: string }[]>([]);
  const [generateExtra, setGenerateExtra] = useState(0);
  const domains = useDomains();
  const action = useServerAction(organizeGraphSelection);
  const claimIds = nodes.filter((node) => isContent(node)).map((node) => node.id);
  const start = (next: "move" | "create") => {
    setIds(nodes.map((node) => node.id));
    setMode(next);
    setDestination("");
    setName("");
    action.reset();
  };
  const lead = mode === "create"
    ? "Creates a domain under the parent you pick, then files the selected claims there."
    : "Files the selected claims in the domain you pick.";
  const active = domains.data ?? [];
  return <>
    {nodes.length > 0 && <div className="absolute top-3 left-3 z-20 flex max-w-[75%] flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-md" aria-label="Selected node actions">
      <span className="text-sm">{nodes.length} selected</span>
      <Button size="sm" variant="outline" onClick={() => start("move")}>Move selected</Button>
      <Button size="sm" variant="outline" onClick={() => start("create")}>Create domain</Button>
      {claimIds.length === 0 ? <Tooltip content="Select claims to generate a domain."><span><Button size="sm" variant="outline" disabled>Generate domain</Button></span></Tooltip> : <Button size="sm" variant="outline" onClick={() => { setGenerateClaims(nodes.filter((node) => isContent(node)).map((node) => ({ id: node.id, label: node.label, text: node.text }))); setGenerateExtra(nodes.length - claimIds.length); setGenerateOpen(true); }}>Generate domain</Button>}
      <Button size="sm" variant="ghost" onClick={onClear}>Clear selection</Button>
      {message && <p role="status" className="text-xs">{message}</p>}
    </div>}
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open && !action.isPending) setMode(null); }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 pr-6">
            <DialogTitle>{mode === "create" ? "Create domain from selection" : "Move selected nodes"}</DialogTitle>
            <InfoPopover label={mode === "create" ? "About creating a domain" : "About moving claims"}>
              <PopoverDescription>{lead}</PopoverDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Each claim is filed only in that domain. Other memberships are replaced.</li>
                <li>Claim text and links stay intact.</li>
              </ul>
            </InfoPopover>
          </div>
          <DialogDescription className="sr-only">{lead}</DialogDescription>
        </DialogHeader>
        <label className="text-sm">{mode === "create" ? "Parent domain" : "Destination domain"}
          <select aria-label="Selection destination domain" className="mt-1 block w-full rounded border bg-background p-2" value={destination} disabled={action.isPending} onChange={(event) => setDestination(event.target.value)}>
            <option value="">Choose a domain</option>
            {active.filter((domain) => !domain.retired_at).map((domain) => <option key={domain.id} value={domain.path}>{domain.path}</option>)}
          </select>
        </label>
        {mode === "create" && <Input aria-label="New domain name" placeholder="New domain name" value={name} disabled={action.isPending} onChange={(event) => setName(event.target.value)} />}
        <ErrorNote error={action.error ?? domains.error?.message} />
        <Button disabled={action.isPending || !destination || (mode === "create" && !name.trim())} onClick={async () => {
          const result = await action.run(ids, destination, mode === "create" ? name : "");
          if (!result.ok) return;
          setMessage(result.status === "applied" ? `${ids.length} claims organized.` : `${result.applied} of ${result.total} actions applied. Review Changes or undo.`);
          setMode(null);
          onClear();
        }}>{action.isPending ? "Saving…" : mode === "create" ? "Create and move selected" : "Move selected"}</Button>
      </DialogContent>
    </Dialog>
    <GenerateDomainDialog open={generateOpen} claims={generateClaims} extraSelected={generateExtra} onOpenChange={setGenerateOpen} onApplied={(text) => { setMessage(text); setGenerateOpen(false); onClear(); }} />
  </>;
}
