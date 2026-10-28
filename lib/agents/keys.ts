import "server-only";

import type { AgentCallCheck, AgentCallRecord, AgentKeyIdentity } from "./types";
import type { AgentScope } from "./scopes";

// =====================================================================
// CONTRACT STUBS: the keys lane replaces these bodies. Signatures stay.
// =====================================================================

// The live credential a bearer token belongs to, or null (unknown, revoked,
// expired, or an OAuth token issued for a different resource than `resource`,
// the canonical MCP server URL, RFC 8707). Accepts OAuth access tokens and personal keys.
export async function resolveAgentKey(token: string, resource: string): Promise<AgentKeyIdentity | null> {
  void token;
  void resource;
  return null;
}

// Whether this key may make another call of this scope now (rate limit, daily cap)
export async function checkAgentCall(keyId: string, scope: AgentScope): Promise<AgentCallCheck> {
  void keyId;
  void scope;
  return { ok: true };
}

// Writes one audit line; never throws (a failed log must not fail the call)
export async function recordAgentCall(record: AgentCallRecord): Promise<void> {
  void record;
}
