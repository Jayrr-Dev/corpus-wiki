"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote, Note, QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SCOPE_INFO } from "@/lib/agents/scopes";
import { listAgentKeys, revokeAgentKey, type AgentKeyRow } from "@/lib/server-actions/agentKeys";
import { AgentCalls } from "./AgentCalls";
import { AgentConnections } from "./AgentConnections";
import { AgentKeyCreated } from "./AgentKeyCreated";
import { AgentKeyForm } from "./AgentKeyForm";

const KEYS_QUERY = ["agent-keys"];

const formatDate = (value: string | null, empty: string) => (value ? new Date(value).toLocaleString() : empty);

// Live, expired or revoked, as of now
function keyState(key: AgentKeyRow): "live" | "expired" | "revoked" {
  if (key.revoked_at) return "revoked";
  if (key.expires_at && Date.parse(key.expires_at) <= Date.now()) return "expired";
  return "live";
}

// AGENTS TAB: agents connected by sign-in, then personal keys for scripts;
// each with its Space, scopes, use and calls, and a way to revoke it
export function AgentKeys() {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AgentKeyRow | null>(null);
  const [openCalls, setOpenCalls] = useState<string | null>(null);
  const revoke = useServerAction(revokeAgentKey, { progress: false, refreshTables: [] });
  const keys = useQuery({
    queryKey: KEYS_QUERY,
    queryFn: async () => {
      const result = await listAgentKeys();
      if (!result.ok) throw new Error(result.error);
      return result;
    },
  });
  const spaceName = (id: string | null) => (id ? (keys.data?.spaces.find((space) => space.id === id)?.name ?? "A deleted Space") : "All Spaces");
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY });

  const confirmRevoke = async () => {
    if (!revoking) return;
    const result = await revoke.run(revoking.id);
    if (!result.ok) return;
    setRevoking(null);
    await refresh();
  };

  return (
    <div className="grid gap-6">
      <p className="text-panel text-muted-foreground">
        Outside agents, such as Claude, Claude Code or Claude Desktop, can use this wiki through its MCP server. Each one works in one Space, or in all of them, and only does what you allowed. Every call is logged.
      </p>
      <QueryState query={keys}>
        <AgentConnections spaceName={spaceName} />
        <div className="border-t pt-6">
          <h3 className="font-medium">Personal keys</h3>
          <p className="mt-1 text-panel text-muted-foreground">For scripts and tools that cannot sign in: the key goes in a request header.</p>
        </div>
        {newKey ? (
          <AgentKeyCreated agentKey={newKey} onDone={() => setNewKey(null)} />
        ) : (
          <div>
            <h4 className="mb-4 text-sm font-medium">New key</h4>
            <AgentKeyForm spaces={keys.data?.spaces ?? []} onCreated={(key) => { setNewKey(key); void refresh(); }} />
          </div>
        )}
        <div>
          <h4 className="mb-4 text-sm font-medium">Keys</h4>
          {keys.data?.keys.length ? (
            <ul className="grid gap-3">
              {keys.data.keys.map((key) => {
                const state = keyState(key);
                return (
                  <li key={key.id} className="rounded-xl border px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium break-words">{key.name}</span>
                          <code className="font-mono text-xs text-muted-foreground">cwk_{key.key_prefix}…</code>
                          {state !== "live" ? <Badge variant="outline">{state === "revoked" ? "Revoked" : "Expired"}</Badge> : null}
                        </div>
                        <p className="mt-1 text-panel text-muted-foreground">
                          {spaceName(key.space_id)} · {key.scopes.map((scope) => SCOPE_INFO[scope].label).join(", ")}
                        </p>
                        <p className="text-panel text-muted-foreground">
                          Last used {formatDate(key.last_used_at, "never")} · {key.expires_at ? `Expires ${formatDate(key.expires_at, "")}` : "No expiry"}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="outline" size="sm" aria-expanded={openCalls === key.id} onClick={() => setOpenCalls(openCalls === key.id ? null : key.id)}>
                          {openCalls === key.id ? "Hide calls" : "Recent calls"}
                        </Button>
                        {state !== "revoked" ? (
                          <Button type="button" variant="destructive" size="sm" onClick={() => { revoke.reset(); setRevoking(key); }}>Revoke</Button>
                        ) : null}
                      </div>
                    </div>
                    {openCalls === key.id ? <div className="mt-3 border-t pt-3"><AgentCalls keyId={key.id} /></div> : null}
                  </li>
                );
              })}
            </ul>
          ) : <Note>No keys yet.</Note>}
        </div>
      </QueryState>
      <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open && !revoke.isPending) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.name}?</DialogTitle>
            <DialogDescription>Agents using this key stop working at their next call. This cannot be undone; make a new key to reconnect.</DialogDescription>
          </DialogHeader>
          <ErrorNote error={revoke.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevoking(null)} disabled={revoke.isPending}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={confirmRevoke} disabled={revoke.isPending}>{revoke.isPending ? "Revoking…" : "Revoke key"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
