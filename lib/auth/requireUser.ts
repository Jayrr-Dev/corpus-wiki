import "server-only";

import { currentAgentSession } from "@/lib/agents/session";
import { requestClaims } from "@/lib/auth/claims";

// GUARD FOR SERVER ACTIONS: they write with the secret key, so each one first
// checks that the caller is signed in (the proxy only guards page loads)
export async function requireUser(): Promise<{ id: string; email: string | null }> {
  // An agent request (/api/mcp) has verified its key and acts as the key's owner
  const agent = currentAgentSession();
  if (agent) return { id: agent.key.personId, email: null };
  const { data, error } = await requestClaims();
  if (error || typeof data?.claims?.sub !== "string") throw new Error("Not signed in.");
  return { id: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
}
