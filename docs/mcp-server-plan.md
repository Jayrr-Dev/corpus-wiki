# MCP server: Corpus Wiki as a knowledge repo for agents

Status: in progress. Chart and lane status live in `TODO.md` ("Plan: MCP server").

## Goal

Outside agents (Claude Code, Claude Desktop, any MCP client) get full control of a Space (also called a Corpus) through `/api/mcp`: read, write, rewrite, delete, create Spaces and change wiki settings. Every power sits behind a per-key scope, and every call is checked, limited and logged.

## Sign-in follows the MCP authorization standard

Spec: MCP authorization, version 2026-07-28 (https://modelcontextprotocol.io/specification/latest/basic/authorization). Claude's connector rules: https://claude.com/docs/connectors/building/authentication. The app is both the resource server (`/api/mcp`) and its own OAuth 2.1 authorization server.

- **Protected Resource Metadata** (RFC 9728) at `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-protected-resource`: `resource` is the exact MCP URL (`<origin>/api/mcp`), `authorization_servers` is `[<origin>]`, `scopes_supported` is `["read"]` (the minimum), `bearer_methods_supported` `["header"]`.
- **401** on a missing or bad token: `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp", scope="read"`.
- **Authorization Server Metadata** (RFC 8414) at `/.well-known/oauth-authorization-server` (also served at the OpenID path): `issuer`, `authorization_endpoint` `/oauth/authorize`, `token_endpoint` `/oauth/token`, `registration_endpoint` `/oauth/register`, `revocation_endpoint` `/oauth/revoke`, `code_challenge_methods_supported` `["S256"]`, `grant_types_supported` `["authorization_code","refresh_token"]`, `response_types_supported` `["code"]`, `token_endpoint_auth_methods_supported` `["none"]`, `client_id_metadata_document_supported` `true`, `authorization_response_iss_parameter_supported` `true`, `scopes_supported` (all five plus `offline_access`).
- **Client registration**: Client ID Metadata Documents first (Claude Code uses one: its `client_id` is an HTTPS URL we fetch, with SSRF guards, a size cap, a timeout and caching), then Dynamic Client Registration (RFC 7591, deprecated in the spec but Claude falls back to it). Public clients only, no secrets.
- **Redirect URIs**: exact match, except loopback (`http://localhost/...`, `http://127.0.0.1/...`) matches with any port. Claude's hosted apps use `https://claude.ai/api/mcp/auth_callback`.
- **Authorize**: the person signs in with the normal app login, then sees a consent screen: client name, redirect host (with a warning when only loopback URIs are registered), the Space (one Space or all), and the scopes, with the requested ones ticked and the rest available to add. PKCE S256 is required. The redirect carries `code`, `state` and `iss` (RFC 9207). Codes last 10 minutes and work once.
- **Token**: form-urlencoded. Checks PKCE, `redirect_uri`, `client_id` and `resource` (RFC 8707). Access tokens are opaque, stored as sha256 hashes, last 1 hour, and are bound to the MCP URL as audience. Refresh tokens rotate on every use; a reused refresh token revokes its whole family. Errors use RFC 6749 codes (`invalid_grant`). Answers well under 10 seconds.
- **Step-up**: every tool is listed. A call whose scope the token lacks gets HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<needed>", resource_metadata="..."`, so the client asks the person for more.
- **Personal keys** (`cwk_...`, made in Settings) stay for scripts and static request headers. They carry their scopes directly.

## How a request is trusted

1. The agent sends `Authorization: Bearer <token>`: an OAuth access token or a personal key. Only sha256 hashes are stored. Revoked or expired credentials fail.
2. `resolveAgentKey(token, resource)` (`lib/agents/keys.ts`) returns the owner, the Space (or null for all Spaces) and the scopes, and refuses an OAuth token issued for another resource.
3. The route checks the `Origin` header (MCP spec, against DNS rebinding) and picks the Space: the key's Space, or for an account-wide key the `space` argument, checked against the owner's Spaces.
4. Every tool is listed. Each call checks the tool's scope (403 `insufficient_scope` for step-up if missing) and the rate limit (`checkAgentCall`).
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

Passwords and sign-in, model API keys, agent access management itself (only a person on the consent screen or in Settings can grant or widen access), permanent deletion of anything the app only archives.

## Later

Enterprise Managed Auth (SSO identity assertions) and a directory listing for claude.ai.
