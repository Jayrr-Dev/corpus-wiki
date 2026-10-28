import "server-only";

import { createHash } from "node:crypto";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import type { AgentCallCheck, AgentCallRecord, AgentKeyIdentity } from "./types";
import { isAgentScope, type AgentScope } from "./scopes";

// =====================================================================
// AGENT KEYS: bearer keys (cwk_...) for the MCP server. The database
// stores only each key's sha256 hash, and these functions reach it only
// through server-only functions
// (supabase/migrations/20261119030500_agent_keys.sql).
// =====================================================================

export const KEY_PREFIX = "cwk_";
// A real key is "cwk_" plus 43 base64url characters; anything far longer is not one
const MAX_TOKEN_LENGTH = 200;

// RATE LIMITS, counted from the audit log (agent_calls)
export const CALLS_PER_MINUTE = 60;
export const CHANGES_PER_DAY = 500;

type ResolvedKey = { id: string; name: string; owner_id: string; space_id: string | null; scopes: string[] };
type CallCounts = { minute: number; day_changes: number };

// The hex sha256 the database stores for a key
export function hashAgentKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// The live key a bearer token belongs to, or null (unknown, revoked or expired)
export async function resolveAgentKey(token: string): Promise<AgentKeyIdentity | null> {
  // Not a key at all: answer without a database call
  if (typeof token !== "string" || !token.startsWith(KEY_PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
  const key = await supabaseRpc(getAdminSupabase()).call<ResolvedKey | null>("resolve_agent_key", { p_hash: hashAgentKey(token) });
  if (!key) return null;
  return {
    keyId: key.id,
    name: key.name,
    personId: key.owner_id,
    spaceId: key.space_id,
    scopes: key.scopes.filter(isAgentScope),
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
    return { ok: false, reason: "Could not check this key's rate limit. Try again shortly." };
  }
  if (counts.minute >= CALLS_PER_MINUTE) {
    return { ok: false, reason: `Rate limit: ${CALLS_PER_MINUTE} calls per minute for this key. Wait a minute, then try again.` };
  }
  if (scope !== "read" && counts.day_changes >= CHANGES_PER_DAY) {
    return { ok: false, reason: `Daily limit: ${CHANGES_PER_DAY} changes per day for this key. Reading still works.` };
  }
  return { ok: true };
}

// Writes one audit line; never throws (a failed log must not fail the call)
export async function recordAgentCall(record: AgentCallRecord): Promise<void> {
  try {
    await supabaseRpc(getAdminSupabase()).call("record_agent_call", {
      p_key: record.keyId,
      p_space: record.spaceId,
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
