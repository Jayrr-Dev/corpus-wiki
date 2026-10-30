import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseRpc } from "@/lib/db/rpc";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { publicationSlug } from "./validation";
import type { ExploreResult, PublicationEditor, PublicWiki, WikiMetrics } from "./types";

// An anonymous client deliberately carries no workspace cookie or secret key.
// Only the public, allowlisted read RPCs are reachable through this port.
function publicReader() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  return supabaseRpc(createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) }) },
  }));
}

export async function readPublicWiki(slug: string, page: string | null = null, embed = false): Promise<PublicWiki | null> {
  if (!publicationSlug.safeParse(slug).success || (page !== null && page.length > 500)) return null;
  return publicReader().call("read_public_wiki", { p_slug: slug, p_page: page, p_embed: embed });
}

export async function explorePublicWikis(query: string, offset = 0): Promise<ExploreResult> {
  return publicReader().call("explore_public_wikis", { p_query: query.slice(0, 120).trim(), p_offset: offset });
}

export async function publicWikiThumbnailPath(slug: string): Promise<string | null> {
  if (!publicationSlug.safeParse(slug).success) return null;
  return publicReader().call("public_wiki_thumbnail", { p_slug: slug });
}

export async function loadPublicationEditor(): Promise<PublicationEditor> {
  await requireUser();
  return supabaseRpc(getAdminSupabase()).call("wiki_publication_editor");
}

export async function loadWikiMetrics(days = 30): Promise<WikiMetrics> {
  await requireUser();
  return supabaseRpc(getAdminSupabase()).call("public_wiki_metrics", { p_days: days });
}
