import "server-only";

import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { isSpaceId as isUuid } from "@/lib/spaces/shared";
import { ACCESS_TOKEN_PREFIX, MAX_SECRET_LENGTH, PERSONAL_KEY_PREFIX, hashSecret } from "./oauth/secrets";
import type { AgentCallCheck, AgentCallRecord, AgentKeyIdentity } from "./types";
import { isAgentScope, type AgentScope } from "./scopes";

// =====================================================================
// AGENT CREDENTIALS: OAuth access tokens (cwa_...) and personal keys
// (cwk_...) for the MCP server. The database stores only their sha256
// hashes and is reached only through server-only functions
// (supabase/migrations/20261119030500_agent_auth.sql).
// =====================================================================

// RATE LIMITS, counted from the audit log (agent_calls)
export const CALLS_PER_MINUTE = 60;
export const CHANGES_PER_DAY = 500;

type ResolvedCredential = { id: string; name: string; owner_id: string; space_id: string | null; scopes: string[]; client_id?: string };
type CallCounts = { minute: number; day_changes: number };

// The live credential a bearer token belongs to, or null (unknown, revoked,
// expired, or an OAuth token issued for a different resource than `resource`,
// the canonical MCP server URL, RFC 8707). Accepts OAuth access tokens and personal keys.
export async function resolveAgentKey(token: string, resource: string): Promise<AgentKeyIdentity | null> {
  // Not a credential at all: answer without a database call
  if (typeof token !== "string" || token.length > MAX_SECRET_LENGTH) return null;
  if (token.startsWith(PERSONAL_KEY_PREFIX)) {
    const key = await supabaseRpc(getAdminSupabase()).call<ResolvedCredential | null>("resolve_agent_key", { p_hash: hashSecret(token) });
    return key ? toIdentity("key", key) : null;
  }
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const grant = await supabaseRpc(getAdminSupabase()).call<ResolvedCredential | null>("resolve_oauth_token", { p_hash: hashSecret(token), p_resource: resource });
    return grant ? toIdentity("oauth", grant) : null;
  }
  return null;
}

// For OAuth, keyId is the grant (one per person and client) and name is the client's name
function toIdentity(kind: AgentKeyIdentity["kind"], credential: ResolvedCredential): AgentKeyIdentity {
  return {
    kind,
    keyId: credential.id,
    clientId: kind === "oauth" ? (credential.client_id ?? null) : null,
    name: credential.name,
    personId: credential.owner_id,
    spaceId: credential.space_id,
    scopes: credential.scopes.filter(isAgentScope),
  };
}

// Whether this key may make another call of this scope now (rate limit, daily cap)
export async function checkAgentCall(keyId: string, scope: AgentScope): Promise<AgentCallCheck> {
  let counts: CallCounts;
  try {
    counts = await supabaseRpc(getAdminSupabase()).call<CallCounts>("agent_call_counts", { p_key: keyId });
  } catch (error) {
    // Fail closed: a limit that cannot be checked is not lifted
    console.error("Agent rate limit check failed:", error);
    return { ok: false, reason: "Could not check this connection's rate limit. Try again shortly." };
  }
  if (counts.minute >= CALLS_PER_MINUTE) {
    return { ok: false, reason: `Rate limit: ${CALLS_PER_MINUTE} calls per minute. Wait a minute, then try again.` };
  }
  if (scope !== "read" && counts.day_changes >= CHANGES_PER_DAY) {
    return { ok: false, reason: `Daily limit: ${CHANGES_PER_DAY} changes per day. Reading still works.` };
  }
  return { ok: true };
}

// Writes one audit line; never throws (a failed log must not fail the call)
export async function recordAgentCall(record: AgentCallRecord): Promise<void> {
  try {
    await supabaseRpc(getAdminSupabase()).call("record_agent_call", {
      p_key: record.keyId,
      // A refused call may name no Space, or something that is not one
      p_space: isUuid(record.spaceId) ? record.spaceId : null,
      p_tool: record.tool,
      p_scope: record.scope,
      p_ok: record.ok,
      p_error: record.error,
      p_ms: Math.max(0, Math.round(record.ms)),
      p_summary: record.summary,
    });
  } catch (error) {
    console.error("Agent call log failed:", error);
  }
}
