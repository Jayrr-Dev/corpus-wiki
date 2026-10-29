"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote, Note, QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { InfoPopover } from "@/components/standard/info-popover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { disconnectGmail, importGmailNow, listGmailLabels, saveGmailLabels } from "@/lib/connectors/gmail/actions";
import type { GmailStatus, ImportResult } from "@/lib/connectors/gmail/service";
import { formatWhen } from "./agentFormat";
import { SettingHint } from "./SettingHint";

// Where Google sent the person back to (/api/gmail/callback), as ?gmail=...
export type GmailOutcome = "connected" | "denied" | "failed" | "setup" | null;

const OUTCOME_ERRORS: Partial<Record<NonNullable<GmailOutcome>, string>> = {
  denied: "Google access was not allowed.",
  failed: "Gmail could not be connected. Try again.",
};

function importLine(result: ImportResult): string {
  const parts = [`${result.imported} new ${result.imported === 1 ? "thread" : "threads"}`];
  if (result.attachments) parts.push(`${result.attachments} ${result.attachments === 1 ? "attachment" : "attachments"}`);
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  if (result.failed) parts.push(`${result.failed} failed`);
  return `Imported ${parts.join(", ")}.${result.more ? " Run again for more." : ""}`;
}

// GMAIL CARD (behind gmail_import): connect a Google account read-only, pick labels, import, disconnect.
// It sees the account address and labels only; the tokens stay on the server.
export function GmailImport({ status, missingEnv, outcome }: { status: GmailStatus; missingEnv: string[]; outcome: GmailOutcome }) {
  const [connection, setConnection] = useState(status);
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const disconnect = useServerAction(disconnectGmail, { progress: false, refreshTables: [] });
  const runImport = useServerAction(importGmailNow, { progress: { title: "Importing from Gmail…", detail: "Reading new threads under the chosen labels…" }, refreshTables: ["sources"] });

  const confirmDisconnect = async () => {
    const result = await disconnect.run();
    if (!result.ok) return;
    setConfirming(false);
    setLastResult(null);
    setConnection({ connected: false });
  };

  const startImport = async () => {
    const result = await runImport.run();
    if (result.ok) {
      setLastResult(result.result);
      if (connection.connected) setConnection({ ...connection, lastImportAt: new Date().toISOString() });
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h3 className="font-medium">Account</h3>
            <InfoPopover label="About Gmail import">
              <p>The app asks Google for read-only Gmail access. It cannot send, change or delete mail.</p>
              <p className="mt-2">Each thread under the chosen labels becomes a source: the subject is its title, the first message’s sent date its date, and each message a passage with its sender and date. Attachments in a supported format are read like uploads.</p>
              <p className="mt-2">Import again to add only threads that are new. Google tokens are stored encrypted on the server.</p>
            </InfoPopover>
          </div>
          {connection.connected ? (
            <Button type="button" size="sm" variant="destructive" onClick={() => { disconnect.reset(); setConfirming(true); }}>Disconnect</Button>
          ) : missingEnv.length === 0 ? (
            <Button asChild size="sm" variant="outline"><a href="/api/gmail/connect">Connect</a></Button>
          ) : null}
        </div>
        {missingEnv.length ? (
          <p className="text-panel text-muted-foreground">Add {missingEnv.join(", ")} to the server environment to connect.</p>
        ) : connection.connected ? (
          <p className="text-panel text-muted-foreground">Connected as {connection.accountEmail}.</p>
        ) : (
          <Note>No Google account connected.</Note>
        )}
        {outcome === "connected" && connection.connected ? <p className="text-panel">Connected.</p> : null}
        <ErrorNote error={OUTCOME_ERRORS[outcome ?? "setup"] ?? null} />
      </div>

      {connection.connected ? (
        <>
          <div className="flex flex-col gap-3 border-t pt-6">
            <div className="flex items-center gap-1.5">
              <h3 className="font-medium">Labels</h3>
              <SettingHint>Threads under any checked label are imported.</SettingHint>
            </div>
            <LabelPicker selected={connection.labelIds} onSaved={(labelIds) => setConnection({ ...connection, labelIds })} />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h3 className="font-medium">Import</h3>
                <SettingHint>Threads imported before are skipped.</SettingHint>
              </div>
              <Button type="button" size="sm" onClick={() => void startImport()} disabled={runImport.isPending || connection.labelIds.length === 0}>
                {runImport.isPending ? "Importing…" : "Import now"}
              </Button>
            </div>
            <p className="text-panel text-muted-foreground">
              {connection.labelIds.length === 0 ? "Pick a label first." : `Last import ${formatWhen(connection.lastImportAt, "never")}.`}
            </p>
            {lastResult ? <p className="text-panel">{importLine(lastResult)}</p> : null}
            <ErrorNote error={runImport.error} />
          </div>
        </>
      ) : null}

      <Dialog open={confirming} onOpenChange={(open) => { if (!open && !disconnect.isPending) setConfirming(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Gmail?</DialogTitle>
            <DialogDescription>This deletes the stored Google tokens and asks Google to end access. Sources already imported stay.</DialogDescription>
          </DialogHeader>
          <ErrorNote error={disconnect.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={disconnect.isPending}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDisconnect()} disabled={disconnect.isPending}>{disconnect.isPending ? "Disconnecting…" : "Disconnect"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// LABEL PICKER: the account's labels as checkboxes; each change is saved at once
function LabelPicker({ selected, onSaved }: { selected: string[]; onSaved: (labelIds: string[]) => void }) {
  const save = useServerAction(saveGmailLabels, { progress: false, refreshTables: [] });
  const labels = useQuery({
    queryKey: ["gmail-labels"],
    queryFn: async () => {
      const result = await listGmailLabels();
      if (!result.ok) throw new Error(result.error);
      return result.labels;
    },
  });

  const toggle = async (id: string, checked: boolean) => {
    const next = checked ? [...selected, id] : selected.filter((labelId) => labelId !== id);
    const result = await save.run(next);
    if (result.ok) onSaved(result.labelIds);
  };

  return (
    <QueryState query={labels}>
      {labels.data?.length ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {labels.data.map((label) => (
            <li key={label.id}>
              <label className="flex items-center gap-2 text-panel">
                <input type="checkbox" className="size-4 accent-primary" checked={selected.includes(label.id)} disabled={save.isPending} onChange={(event) => void toggle(label.id, event.target.checked)} />
                {label.name}
              </label>
            </li>
          ))}
        </ul>
      ) : <Note>No labels found.</Note>}
      <ErrorNote error={save.error} />
    </QueryState>
  );
}
