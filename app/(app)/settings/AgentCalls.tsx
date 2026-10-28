"use client";

import { useQuery } from "@tanstack/react-query";
import { Note, QueryState } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { listAgentCalls } from "@/lib/server-actions/agentKeys";

// RECENT CALLS: one personal key's or connected agent's audit log, newest first
export function AgentCalls({ keyId }: { keyId: string }) {
  const calls = useQuery({
    queryKey: ["agent-calls", keyId],
    queryFn: async () => {
      const result = await listAgentCalls(keyId);
      if (!result.ok) throw new Error(result.error);
      return result.calls;
    },
  });
  return (
    <QueryState query={calls}>
      {calls.data?.length ? (
        <ol className="grid gap-1 text-panel">
          {calls.data.map((call) => (
            <li key={call.id} className="flex min-w-0 items-start gap-2">
              <StatusDot tone={call.ok ? "applied" : "failed"} className="mt-1.5" />
              <span className="min-w-0">
                <span className="font-mono text-xs">{call.tool}</span>
                <span className="text-muted-foreground"> · {call.scope} · {call.ms} ms · {new Date(call.created_at).toLocaleString()}</span>
                {call.summary ? <span className="block truncate text-muted-foreground">{call.summary}</span> : null}
                {call.error ? <span className="block text-muted-foreground">{call.error}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : <Note>No calls yet.</Note>}
    </QueryState>
  );
}
