import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { withSpaceActor } from "@/lib/auth/currentPerson";
import type { AgentSession } from "./types";

// =====================================================================
// AN AGENT REQUEST acts as the key's owner, in one Space, with no
// browser session. Inside withAgentSession, requireUser() returns the
// owner and getServerSupabase() returns the admin client, which names
// the person and Space on every call. The database's space_runtime role
// then limits every read and write to that Space
// (supabase/migrations/20261118184000_spaces.sql), as for uploads.
// Only /api/mcp opens a session, after it has verified the key.
// =====================================================================

const store = new AsyncLocalStorage<AgentSession>();

export function withAgentSession<T>(session: AgentSession, run: () => Promise<T>): Promise<T> {
  const actor = { personId: session.key.personId, via: "agent" as const, spaceId: session.spaceId };
  return store.run(session, () => withSpaceActor(actor, run));
}

// The agent session this code runs inside, or null for a person or script
export function currentAgentSession(): AgentSession | null {
  return store.getStore() ?? null;
}
