"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { ErrorNote, Note, QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SCOPE_INFO } from "@/lib/agents/scopes";
import { listAgentConnections, revokeAgentConnection, type AgentConnectionRow } from "@/lib/server-actions/agentKeys";
import { AgentCalls } from "./AgentCalls";

const CONNECTIONS_QUERY = ["agent-connections"];

const noSubscribe = () => () => {};
const readOrigin = () => window.location.origin;
const readNoOrigin = () => "https://your-corpus-wiki";

// CONNECTED AGENTS: MCP clients the person allowed through sign-in and consent
export function AgentConnections({ spaceName }: { spaceName: (id: string | null) => string }) {
  const queryClient = useQueryClient();
  const origin = useSyncExternalStore(noSubscribe, readOrigin, readNoOrigin);
  const [revoking, setRevoking] = useState<AgentConnectionRow | null>(null);
  const [openCalls, setOpenCalls] = useState<string | null>(null);
  const revoke = useServerAction(revokeAgentConnection, { progress: false, refreshTables: [] });
  const connections = useQuery({
    queryKey: CONNECTIONS_QUERY,
    queryFn: async () => {
      const result = await listAgentConnections();
      if (!result.ok) throw new Error(result.error);
      return result.connections;
    },
  });

  const confirmRevoke = async () => {
    if (!revoking) return;
    const result = await revoke.run(revoking.id);
    if (!result.ok) return;
    setRevoking(null);
    await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY });
  };

  return (
    <div>
      <h3 className="font-medium">Connected agents</h3>
      <p className="mt-1 mb-4 text-panel text-muted-foreground">
        Add <code className="font-mono text-xs break-all">{origin}/api/mcp</code> as a connector in Claude, or run{" "}
        <code className="font-mono text-xs break-all">claude mcp add --transport http corpus-wiki {origin}/api/mcp</code>{" "}
        in a terminal. The agent then asks you to sign in here and choose a Space and what it may do.
      </p>
      <QueryState query={connections}>
        {connections.data?.length ? (
          <ul className="grid gap-3">
            {connections.data.map((connection) => (
              <li key={connection.id} className="rounded-xl border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium break-words">{connection.client_name}</span>
                    <p className="mt-1 text-panel text-muted-foreground">
                      {spaceName(connection.space_id)} · {connection.scopes.map((scope) => SCOPE_INFO[scope].label).join(", ")}
                    </p>
                    <p className="text-panel text-muted-foreground">
                      Connected {new Date(connection.created_at).toLocaleString()} · Last used {connection.last_used_at ? new Date(connection.last_used_at).toLocaleString() : "never"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="outline" size="sm" aria-expanded={openCalls === connection.id} onClick={() => setOpenCalls(openCalls === connection.id ? null : connection.id)}>
                      {openCalls === connection.id ? "Hide calls" : "Recent calls"}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => { revoke.reset(); setRevoking(connection); }}>Revoke</Button>
                  </div>
                </div>
                {openCalls === connection.id ? <div className="mt-3 border-t pt-3"><AgentCalls keyId={connection.id} /></div> : null}
              </li>
            ))}
          </ul>
        ) : <Note>No agents connected yet.</Note>}
      </QueryState>
      <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open && !revoke.isPending) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {revoking?.client_name}?</DialogTitle>
            <DialogDescription>It stops working at its next call. To use it again, it has to ask you to sign in and allow it again.</DialogDescription>
          </DialogHeader>
          <ErrorNote error={revoke.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevoking(null)} disabled={revoke.isPending}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={confirmRevoke} disabled={revoke.isPending}>{revoke.isPending ? "Revoking…" : "Revoke access"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
