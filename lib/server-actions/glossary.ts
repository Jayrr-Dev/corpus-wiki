"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { generateGlossary } from "@/lib/glossary/generate";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { embedMissingGlossary, similarGlossary } from "@/lib/glossary/embeddingStore";
import { glossaryClient } from "@/lib/glossary/storage";
import { toActionResult } from "./result";
import { z } from "zod";
import type { GlossaryEntry } from "@/lib/glossary/entries";

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

export async function requestGlossaryGeneration(force = false) {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Configure the AI provider in Settings to generate your dictionary.");
    after(async () => {
      try {
        await generateGlossary(client, settings, force);
        const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "glossary_embeddings", role: "dictionary_editor" } }));
        if (embedder) await embedMissingGlossary(db, embedder);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Glossary generation failed:", message);
        // Failures before the lease is claimed must also be visible in the page.
        await glossaryClient(client).from("glossary_state").update({ error: message }).eq("id", true).is("lease_token", null);
      }
    });
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
