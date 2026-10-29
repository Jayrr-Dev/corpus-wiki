import "server-only";

import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { isFeatureEnabled } from "@/lib/flags/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { tokenKeyFrom } from "./crypto";
import type { GoogleClient } from "./oauth";
import { type GmailService, type GmailStatus, gmailService } from "./service";
import { gmailStore } from "./store";

// =====================================================================
// GMAIL IMPORT ON THE SERVER: the service wired to Supabase, Google's
// endpoints and the env. Server only (the secret, the token key and the
// stored tokens never reach a browser).
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   the Google OAuth web client
//   GMAIL_TOKEN_KEY                          32 bytes (base64) sealing stored tokens
//   GOOGLE_REDIRECT_URI (optional)           else <origin>/api/gmail/callback
// =====================================================================

export const GMAIL_CALLBACK_PATH = "/api/gmail/callback";

// The env names the card lists when one is missing
export function missingGmailEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_TOKEN_KEY"].filter((name) => !env[name]?.trim());
}

export function googleClient(origin: string | null, env: NodeJS.ProcessEnv = process.env): GoogleClient {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server to connect Gmail.");
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() || (origin ? `${origin}${GMAIL_CALLBACK_PATH}` : "");
  return { clientId, clientSecret, redirectUri };
}

// SETTINGS > GMAIL: null while the gmail_import flag is off (no card, no tab); else what the card
// shows on load: whether the person is connected (never the tokens) and which env is missing
export async function loadGmailCard(): Promise<{ status: GmailStatus; missingEnv: string[] } | null> {
  if (!(await isFeatureEnabled("gmail_import"))) return null;
  const { id } = await requireUser();
  const connection = await gmailStore(supabaseRpc(getAdminSupabase())).connection(id);
  const status: GmailStatus = connection
    ? { connected: true, accountEmail: connection.accountEmail, labelIds: connection.labelIds, lastImportAt: connection.lastImportAt }
    : { connected: false };
  return { status, missingEnv: missingGmailEnv() };
}

export function serverGmailService(origin: string | null = null): GmailService {
  return gmailService({
    store: gmailStore(supabaseRpc(getAdminSupabase())),
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(30_000) }),
    key: tokenKeyFrom(process.env.GMAIL_TOKEN_KEY),
    client: googleClient(origin),
  });
}
