import "server-only";

import { currentAgentSession } from "@/lib/agents/session";
import { requestClaims } from "@/lib/auth/claims";

// The signed-in person. Name and picture come from the session's user metadata:
// full_name from email signup, name and avatar_url (or picture) from Google.
export type SignedInUser = { id: string; email: string | null; name?: string | null; avatarUrl?: string | null };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

// GUARD FOR SERVER ACTIONS: they write with the secret key, so each one first
// checks that the caller is signed in (the proxy only guards page loads)
export async function requireUser(): Promise<SignedInUser> {
  // An agent request (/api/mcp) has verified its key and acts as the key's owner
  const agent = currentAgentSession();
  if (agent) return { id: agent.key.personId, email: null };
  const { data, error } = await requestClaims();
  if (error || typeof data?.claims?.sub !== "string") throw new Error("Not signed in.");
  const meta = (data.claims.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    name: text(meta.full_name) ?? text(meta.name),
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
  };
}
