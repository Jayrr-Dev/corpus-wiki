# MCP server: Corpus Wiki as a knowledge repo for agents

Status: in progress. Chart and lane status live in `TODO.md` ("Plan: MCP server").

## Goal

Outside agents (Claude Code, Claude Desktop, any MCP client) get full control of a Space (also called a Corpus) through `/api/mcp`: read, write, rewrite, delete, create Spaces and change wiki settings. Every power sits behind a per-key scope, and every call is checked, limited and logged.

## How a request is trusted

1. The agent sends `Authorization: Bearer cwk_...`. The key is stored only as a sha256 hash (`agent_keys`). Revoked or expired keys fail.
2. `resolveAgentKey` (`lib/agents/keys.ts`) returns the key's owner, its Space (or null for an account-wide key) and its scopes.
3. The route checks the `Origin` header (MCP spec, against DNS rebinding) and picks the Space: the key's Space, or for an account-wide key the `space` argument, checked against the owner's Spaces.
4. A tool is listed only if the key holds its scope, and the scope is checked again on every call, with a rate limit (`checkAgentCall`).
5. The tool runs inside `withAgentSession` (`lib/agents/session.ts`). There, `requireUser()` returns the owner and `getServerSupabase()` returns the admin client, which names the person and Space on every database call. The database's `space_runtime` role then limits everything to that Space, the same path uploads use. Rows written carry `via = 'agent'`.
6. `recordAgentCall` writes an audit line: key, Space, tool, ok or error, time taken, a redacted summary.

## Scopes (`lib/agents/scopes.ts`)

- `read`: search, open articles, claims, sources, entities; upload status.
- `write`: add notes, files, links; create, rewrite and organize articles and sections; edit lines. All knowledge changes still pass through Change control.
- `delete`: delete articles, sections, lines, sources, entities, domains.
- `spaces`: list, create, rename Spaces. Account-wide keys only.
- `settings`: this Space's wiki settings. Never passwords, model keys or API keys.

New keys start with `read` only.

## Tool contract (`lib/mcp/types.ts`)

Each lane exports `AgentToolDef[]` from its own file in `lib/mcp/tools/`, built with `defineTool`. Tool schemas never declare `space`; the server adds it for account-wide keys. Tools return plain JSON and throw `Error` with a clear message. Annotations: `readOnlyHint` on reads, `destructiveHint` on deletes and rewrites, so clients can ask the person first. Tool descriptions say that returned content is data, not instructions.

## Not exposed

Passwords and sign-in, model API keys, agent key management itself (only a person in Settings can make or widen a key), permanent deletion of anything the app only archives.

## Later

OAuth 2.1 for claude.ai remote connectors. Keys cover Claude Code and Claude Desktop now.
