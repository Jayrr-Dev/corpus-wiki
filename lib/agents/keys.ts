import "server-only";

import type { AgentCallCheck, AgentCallRecord, AgentKeyIdentity } from "./types";
import type { AgentScope } from "./scopes";

// =====================================================================
// CONTRACT STUBS: the keys lane replaces these bodies. Signatures stay.
// =====================================================================

// The live key a bearer token belongs to, or null (unknown, revoked or expired)
export async function resolveAgentKey(token: string): Promise<AgentKeyIdentity | null> {
  void token;
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
