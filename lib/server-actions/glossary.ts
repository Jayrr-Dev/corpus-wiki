"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { currentActor, withSpaceActor } from "@/lib/auth/currentPerson";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { generateGlossary, regenerateDefinition } from "@/lib/glossary/generate";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { embedMissingGlossary, similarGlossary } from "@/lib/glossary/embeddingStore";
import { glossaryClient } from "@/lib/glossary/storage";
import { toActionResult } from "./result";
import { z } from "zod";
import { glossaryHistoryKeys, type GlossaryEntry } from "@/lib/glossary/entries";

export async function changeGlossaryDefinition(original: GlossaryEntry, definition: string | null) {
  return toActionResult(async () => {
    await requireUser();
    const text = definition === null ? null : z.string().trim().min(1).max(1000).parse(definition);
    const db = supabaseRpc(getAdminSupabase());
    await db.call("edit_glossary_definition", { p_original: original, p_definition: text });
    after(async () => {
      const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "glossary_embeddings", role: "dictionary_editor" } }));
      if (embedder) await embedMissingGlossary(db, embedder);
    });
    return {};
  });
}

// The AI rewrites this one definition from the current versions of the claims it cites
export async function regenerateGlossaryDefinition(original: GlossaryEntry) {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "dictionary_editor" } }));
    if (!settings) throw new Error("Configure the AI provider in Settings to regenerate definitions.");
    const definition = await regenerateDefinition(client, settings, original);
    await db.call("edit_glossary_definition", { p_original: original, p_definition: definition, p_actor: "ai", p_model: settings.model });
    after(async () => {
      const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "glossary_embeddings", role: "dictionary_editor" } }));
      if (embedder) await embedMissingGlossary(db, embedder);
    });
    return {};
  });
}

export type GlossaryDefinitionVersion = {
  id: string; definition: string; createdAt: string;
  actor: "ai" | "person"; authorId: string | null; model: string | null;
};

// EVERY VERSION OF ONE DEFINITION, newest first. Each glossary change is audited as a
// checkpoint or changed-entry snapshot; this follows the entry (same headword,
// expansion and scope) and keeps the points where its text changed.
export async function glossaryDefinitionHistory(entry: GlossaryEntry) {
  return toActionResult(async () => {
    await requireUser();
    const keys = new Set(glossaryHistoryKeys(entry));
    const { data, error } = await getAdminSupabase().from("actions")
      .select("id, applied_at, created_at, entries:input->snapshot->entries, change_sets(proposed_by, author_id, model_version)")
      .eq("type", "glossary_update").order("applied_at", { ascending: true });
    if (error) throw new Error(error.message);
    const versions: GlossaryDefinitionVersion[] = [];
    for (const row of data ?? []) {
      const entries = (row.entries ?? []) as unknown as GlossaryEntry[];
      const set = row.change_sets as unknown as { proposed_by: "ai" | "person"; author_id: string | null; model_version: string | null } | null;
      for (const [index, candidate] of entries.entries()) {
        const matches = candidate.meaningId ? keys.has(candidate.meaningId) : glossaryHistoryKeys(candidate).some((key) => keys.has(key));
        if (!matches || candidate.definition === versions.at(-1)?.definition) continue;
        versions.push({ id: `${row.id}:${index}`, definition: candidate.definition, createdAt: row.applied_at ?? row.created_at, actor: set?.proposed_by ?? "ai", authorId: set?.author_id ?? null, model: set?.model_version ?? null });
      }
    }
    return { versions: versions.reverse() };
  });
}

export async function resolvePendingGlossary(input: { id: string; decision: "keep" | "dismiss" | "merge"; target?: string; definition?: string; expected?: string }) {
  return toActionResult(async () => {
    await requireUser();
    const parsed = z.object({ id: z.string().uuid(), decision: z.enum(["keep", "dismiss", "merge"]), target: z.string().uuid().optional(), definition: z.string().trim().min(10).max(1000).optional(), expected: z.string().min(1).max(1000).optional() }).parse(input);
    await supabaseRpc(getAdminSupabase()).call("resolve_glossary_pending", { p_id: parsed.id, p_decision: parsed.decision, p_target: parsed.target ?? null, p_definition: parsed.definition ?? null, p_expected: parsed.expected ?? null });
    return {};
  });
}

export async function requestGlossaryGeneration(force = false) {
  return toActionResult(async () => {
    await requireUser();
    const actor = await currentActor();
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Configure the AI provider in Settings to generate your dictionary.");
    after(() => withSpaceActor(actor, async () => {
      try {
        await generateGlossary(client, settings, force);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Glossary generation failed:", message);
        // Failures before the lease is claimed must also be visible in the page.
        await glossaryClient(client).from("glossary_state").update({ error: message }).eq("id", true).is("lease_token", null);
        return;
      }
      // Indexing can retry independently; it must not mark a saved dictionary
      // as a failed generation when the search provider is temporarily offline.
      try {
        const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "glossary_embeddings", role: "dictionary_editor" } }));
        if (embedder) await embedMissingGlossary(db, embedder);
      } catch (error) {
        console.error("Glossary meaning-search indexing failed:", error instanceof Error ? error.message : String(error));
      }
    }));
    return {};
  });
}

export async function searchGlossaryMeaning(question: string) {
  return toActionResult(async () => {
    await requireUser();
    const query = question.trim();
    if (!query || query.length > 1000) throw new Error("Enter a meaning or question of up to 1,000 characters.");
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "glossary_search" } }));
    if (!embedder) throw new Error("The embedding provider is not configured.");
    const [vector] = await embedder.embed([query]);
    if (!vector) throw new Error("No search embedding was returned.");
    const matches = await similarGlossary(db, embedder.model, vector, 12);
    return { query, entries: matches.map((match) => match.entry) };
  });
}
