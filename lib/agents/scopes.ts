// =====================================================================
// AGENT KEY SCOPES: what an outside agent (through the MCP server at
// /api/mcp) may do with a key. Every tool names exactly one scope; the
// server lists and runs a tool only when the key holds that scope.
// =====================================================================

export const AGENT_SCOPES = ["read", "write", "delete", "spaces", "settings"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const SCOPE_INFO: Record<AgentScope, { label: string; description: string }> = {
  read: { label: "Read", description: "Search knowledge and open articles, claims, sources and entities." },
  write: { label: "Write", description: "Add notes, files and links; create, rewrite and organize articles. Changes still pass through Change control." },
  delete: { label: "Delete", description: "Remove articles, sections, lines, sources, entities and domains." },
  spaces: { label: "Spaces", description: "List Spaces and create or rename them. Needs a key that is not tied to one Space." },
  settings: { label: "Settings", description: "Change this Space's wiki settings. Never passwords or model keys." },
};

// A new key starts with read only; every other scope is opted into
export const DEFAULT_SCOPES: readonly AgentScope[] = ["read"];

export function isAgentScope(value: string): value is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(value);
}
