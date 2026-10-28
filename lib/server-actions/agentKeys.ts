"use server";

import { currentAgentSession } from "@/lib/agents/session";
import { AGENT_SCOPES, isAgentScope, type AgentScope } from "@/lib/agents/scopes";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSpaceId as isUuid } from "@/lib/spaces/shared";
import { toActionResult } from "./result";

// =====================================================================
// AGENTS IN SETTINGS: a person sees and revokes the agents connected
// through OAuth sign-in, and makes, lists and revokes personal keys for
// scripts. Only a person may do this, never an agent
// (docs/mcp-server-plan.md). Reads go through the person's own session
// (RLS shows their rows, never key_hash); writes go through the database
// functions (supabase/migrations/20261119030500_agent_auth.sql).
// =====================================================================

export type AgentKeyRow = {
  id: string;
  name: string;
  space_id: string | null;
  key_prefix: string;
  scopes: AgentScope[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type AgentCallRow = { id: string; tool: string; scope: string; ok: boolean; error: string | null; ms: number; summary: string; created_at: string };

export type AgentKeyInput = { name: string; spaceId: string | null; scopes: string[]; expiresAt: string | null };

const KEY_COLUMNS = "id, name, space_id, key_prefix, scopes, expires_at, revoked_at, last_used_at, created_at";
const RECENT_CALLS = 50;

// A signed-in person, never an agent acting as them
async function requirePerson() {
  if (currentAgentSession()) throw new Error("Agents cannot manage agent keys.");
  return requireUser();
}

// The person's keys (newest first) and the Spaces a key may be tied to
export async function listAgentKeys() {
  return toActionResult(async () => {
    await requirePerson();
    const supabase = await getServerSupabase();
    const [keys, spaces] = await Promise.all([
      supabase.from("agent_keys").select(KEY_COLUMNS).order("created_at", { ascending: false }),
      supabase.from("spaces").select("id, name").order("created_at").order("id"),
    ]);
    if (keys.error) throw new Error(keys.error.message);
    if (spaces.error) throw new Error(spaces.error.message);
    const rows: AgentKeyRow[] = (keys.data ?? []).map((key) => ({ ...key, scopes: key.scopes.filter(isAgentScope) }));
    return { keys: rows, spaces: spaces.data ?? [] };
  });
}

// Makes a key and returns its plain value; this is the only time it is shown
export async function createAgentKey(input: AgentKeyInput) {
  return toActionResult(async () => {
    await requirePerson();
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 80) throw new Error("Use a key name between 1 and 80 characters.");
    const spaceId = input.spaceId ?? null;
    if (spaceId !== null && (typeof spaceId !== "string" || !isUuid(spaceId))) throw new Error("Choose a valid Space.");
    const scopes = AGENT_SCOPES.filter((scope) => Array.isArray(input.scopes) && input.scopes.includes(scope));
    if (scopes.length === 0) throw new Error("Choose at least one scope.");
    if (spaceId !== null && scopes.includes("spaces")) throw new Error("The Spaces scope needs a key for all Spaces.");
    let expiresAt: string | null = null;
    if (input.expiresAt) {
      const time = Date.parse(input.expiresAt);
      if (Number.isNaN(time)) throw new Error("Choose a valid expiry date.");
      if (time <= Date.now()) throw new Error("Choose an expiry date in the future.");
      expiresAt = new Date(time).toISOString();
    }
    const created = await supabaseRpc(getAdminSupabase()).call<AgentKeyRow & { key: string }>("create_agent_key", {
      p_name: name, p_space: spaceId, p_scopes: scopes, p_expires_at: expiresAt,
    });
    return { key: created.key, keyId: created.id };
  });
}

// Revokes one of the person's keys; agents using it stop at their next call
export async function revokeAgentKey(id: string) {
  return toActionResult(async () => {
    await requirePerson();
    if (typeof id !== "string" || !isUuid(id)) throw new Error("Choose a valid key.");
    await supabaseRpc(getAdminSupabase()).call("revoke_agent_key", { p_id: id });
    return {};
  });
}

// The latest calls one key or connection made (the audit log), newest first
export async function listAgentCalls(id: string) {
  return toActionResult(async () => {
    await requirePerson();
    if (typeof id !== "string" || !isUuid(id)) throw new Error("Choose a valid key or connection.");
    const { data, error } = await (await getServerSupabase())
      .from("agent_calls")
      .select("id, tool, scope, ok, error, ms, summary, created_at")
      .or(`key_id.eq.${id},grant_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(RECENT_CALLS);
    if (error) throw new Error(error.message);
    const calls: AgentCallRow[] = data ?? [];
    return { calls };
  });
}

// =====================================================================
// CONNECTED AGENTS: MCP clients the person allowed through OAuth sign-in
// (one live grant per client). Revoking one ends its tokens at once.
// =====================================================================

export type AgentConnectionRow = {
  id: string;
  client_id: string;
  client_name: string;
  space_id: string | null;
  scopes: AgentScope[];
  created_at: string;
  last_used_at: string | null;
};

// The person's live connections, newest first
export async function listAgentConnections() {
  return toActionResult(async () => {
    await requirePerson();
    const supabase = await getServerSupabase();
    const grants = await supabase
      .from("oauth_grants")
      .select("id, client_id, space_id, scopes, created_at, last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (grants.error) throw new Error(grants.error.message);
    const clientIds = [...new Set((grants.data ?? []).map((grant) => grant.client_id))];
    const clients = clientIds.length
      ? await supabase.from("oauth_clients").select("client_id, name").in("client_id", clientIds)
      : { data: [], error: null };
    if (clients.error) throw new Error(clients.error.message);
    const names = new Map((clients.data ?? []).map((client) => [client.client_id, client.name]));
    const connections: AgentConnectionRow[] = (grants.data ?? []).map((grant) => ({
      ...grant,
      client_name: names.get(grant.client_id) ?? grant.client_id,
      scopes: grant.scopes.filter(isAgentScope),
    }));
    return { connections };
  });
}

// Disconnects an agent: its grant and every token it holds stop working
export async function revokeAgentConnection(id: string) {
  return toActionResult(async () => {
    await requirePerson();
    if (typeof id !== "string" || !isUuid(id)) throw new Error("Choose a valid connection.");
    await supabaseRpc(getAdminSupabase()).call("revoke_oauth_grant", { p_id: id });
    return {};
  });
}
