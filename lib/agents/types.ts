import type { AgentScope } from "./scopes";

// A verified agent key: who it acts as, where, and what it may do.
// spaceId null means the key may act in any Space its owner owns,
// chosen per call (tools take an optional `space` argument).
export type AgentKeyIdentity = {
  keyId: string;
  name: string;
  personId: string;
  spaceId: string | null;
  scopes: AgentScope[];
};

// One MCP request: the key, plus the Space this request acts in
export type AgentSession = { key: AgentKeyIdentity; spaceId: string };

// What a call is allowed to do right now (rate limits, daily caps)
export type AgentCallCheck = { ok: true } | { ok: false; reason: string };

// One line of the audit log, written after every tool call
export type AgentCallRecord = {
  keyId: string;
  spaceId: string;
  tool: string;
  scope: AgentScope;
  ok: boolean;
  error: string | null;
  ms: number;
  // A short, redacted summary of the arguments (never file contents)
  summary: string;
};
