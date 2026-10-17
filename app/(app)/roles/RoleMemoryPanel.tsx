"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { ErrorNote, Note, QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { MODEL_ROLES, type ModelRole, roleName } from "@/lib/ai/roles";
import { clearRoleMemory, readRoleMemory } from "@/lib/server-actions/skills";
import { ROLE_ICONS } from "../workflow/roleIcons";

// =====================================================================
// ROLE MEMORY: the notes each role saved for its future runs (lib/ai/memory.ts),
// with a way to drop one note or a role's whole memory. Run notes live only
// in the server's memory for one run, so they are not listed here.
// =====================================================================

const QUERY_KEY = ["table", "ai_role_memory"];

export function RoleMemoryPanel() {
  const client = useQueryClient();
  const memory = useQuery({ queryKey: QUERY_KEY, queryFn: async () => {
    const result = await readRoleMemory(); if (!result.ok) throw new Error(result.error); return result.memory;
  } });
  const clear = useServerAction(clearRoleMemory);
  const run = async (role: ModelRole, key: string | null) => {
    const result = await clear.run(role, key);
    if (result.ok) await client.invalidateQueries({ queryKey: QUERY_KEY });
  };
  const roles = MODEL_ROLES.filter((role) => memory.data?.[role]?.length);

  return <section aria-labelledby="role-memory-title" className="space-y-3 pt-4">
    <div>
      <h2 id="role-memory-title" className="text-panel font-semibold">Role memory</h2>
      <p className="mt-1 max-w-2xl text-panel text-muted-foreground">Notes each role keeps for its future runs: workspace conventions, decisions it will need again, lookup results. They are hints, never evidence. Notes for a single run stay in the server’s memory and are not listed.</p>
    </div>
    <ErrorNote error={clear.error} />
    <QueryState query={memory}>
      {roles.length === 0 ? <Note>No role has saved a note yet.</Note> : <div className="divide-y overflow-hidden rounded-lg border">
        {roles.map((role) => {
          const Icon = ROLE_ICONS[role] ?? Sparkles;
          const entries = memory.data?.[role] ?? [];
          return <details key={role} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-panel transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted-foreground" />
              <span className="font-medium">{roleName(role)}</span>
              <span className="rounded-sm bg-hover px-1.5 font-mono text-xs text-muted-foreground">{entries.length}</span>
              <span aria-hidden="true" className="ml-auto text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <ul className="divide-y border-t">
              {entries.map((entry) => <li key={entry.key} className="group/note flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-xs text-foreground">{entry.key}</p>
                  <p className="mt-0.5 text-panel break-words whitespace-pre-wrap text-muted-foreground">{entry.value}</p>
                  <p className="mt-1 text-xs text-faint">{entry.source ? `${entry.source} · ` : ""}{new Date(entry.updatedAt).toLocaleString()}{entry.expiresAt ? ` · expires ${new Date(entry.expiresAt).toLocaleString()}` : ""}</p>
                </div>
                <Tooltip content="Forget this note">
                  <button type="button" aria-label={`Forget ${entry.key}`} disabled={clear.isPending} onClick={() => void run(role, entry.key)} className="flex size-6 shrink-0 items-center justify-center rounded text-faint opacity-100 hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 sm:opacity-0 sm:group-hover/note:opacity-100 sm:focus-visible:opacity-100"><X size={12} /></button>
                </Tooltip>
              </li>)}
            </ul>
            <div className="flex justify-end border-t px-4 py-2">
              <Button type="button" size="sm" variant="ghost" disabled={clear.isPending} onClick={() => void run(role, null)}>Clear {roleName(role)} memory</Button>
            </div>
          </details>;
        })}
      </div>}
    </QueryState>
  </section>;
}
