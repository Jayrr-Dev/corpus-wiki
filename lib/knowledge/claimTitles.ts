import "server-only";

import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { knowledgeLabel } from "./label";

// =====================================================================
// CLAIM TITLES BACKFILL: names live claims that have no title yet (claims
// read before extraction gave each one a title). Claims sharing a derived
// topic label go to the model together, so their titles read apart.
// Only empty titles are filled (save_revision_titles).
// =====================================================================

const BATCH_SIZE = 30;

const answerSchema = z.object({ titles: z.array(z.object({ ref: z.string(), title: z.string() })) });
const answerJsonSchema = z.toJSONSchema(answerSchema);

const SYSTEM_PROMPT = `You name claims in a knowledge store. Each claim gets a title of 2 to 6 words that says what THIS claim states, so it reads apart from the other claims listed with it, which are often on the same topic.
Good: "Class A violations: termination", "Hard hats required on site", "WHMIS refresher every 3 years". Bad: a bare topic ("Discipline policy"), the company name, a full sentence.
Use only what the claim says. Two claims that say the same thing may share a title.
Answer with JSON only: { "titles": [{ "ref": "C1", "title": "..." }] }, one entry per claim.`;

type Untitled = { revisionId: string; content: string; topic: string };

// Live claims whose current revision has no title, grouped by topic so siblings share a batch
async function loadUntitled(client: AdminSupabase): Promise<Untitled[]> {
  const units: { current_revision_id: string }[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await client.from("units").select("current_revision_id").is("retired_at", null).order("id").range(start, start + 999);
    if (page.error) throw page.error;
    units.push(...page.data);
    if (page.data.length < 1000) break;
  }
  const untitled: Untitled[] = [];
  const ids = units.map((unit) => unit.current_revision_id);
  for (let start = 0; start < ids.length; start += 200) {
    const chunk = await client.from("revisions").select("id, content, title").in("id", ids.slice(start, start + 200));
    if (chunk.error) throw chunk.error;
    for (const revision of chunk.data) {
      if (!revision.title?.trim() && revision.content.trim()) untitled.push({ revisionId: revision.id, content: revision.content, topic: knowledgeLabel(revision.content) });
    }
  }
  return untitled.sort((a, b) => a.topic.localeCompare(b.topic));
}

// Titles every untitled live claim; returns how many were saved
export async function titleUntitledClaims(deps: { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings }): Promise<number> {
  const untitled = await loadUntitled(deps.client);
  let saved = 0;
  for (let start = 0; start < untitled.length; start += BATCH_SIZE) {
    const batch = untitled.slice(start, start + BATCH_SIZE);
    const answer = await chatJson(deps.settings, {
      name: "claim_titles",
      schema: answerSchema,
      jsonSchema: answerJsonSchema,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ claims: batch.map((claim, index) => ({ ref: `C${index + 1}`, content: claim.content })) }) },
      ],
    });
    const byRef = new Map(batch.map((claim, index) => [`C${index + 1}`, claim]));
    const rows = answer.value.titles.flatMap(({ ref, title }) => {
      const claim = byRef.get(ref.trim().toUpperCase());
      const clean = title.trim().replace(/[.]+$/, "");
      return claim && clean ? [{ revisionId: claim.revisionId, title: clean }] : [];
    });
    if (rows.length) saved += await deps.db.call<number>("save_revision_titles", { p_rows: rows });
  }
  return saved;
}
