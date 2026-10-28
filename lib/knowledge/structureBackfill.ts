import "server-only";

import { z } from "zod";
import { chatJson, type ChatMessage, type TokenFactorySettings } from "@/lib/ai/chat";
import { SENIORITY_GUIDE, STRUCTURE_LINK_GUIDE } from "@/lib/ai/tokenFactory/prompt";
import { structureLabelSchema } from "@/lib/ai/tokenFactory/schema";
import { supabaseRpc } from "@/lib/db/rpc";
import { PARTIAL_DATE, type StructureLabel } from "@/lib/stakeholders/structure";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// STRUCTURE BACKFILL: claims saved before structure labels get their links
// read by the model from the claim text and its entities, then written by
// public.backfill_structure (20261119029000), which checks them against the
// claim's own entities. No claim is revised, so no page goes stale.
// =====================================================================

export type BackfillClaim = { unitId: string; content: string; entities: { type: string; key: string; name: string; stakeholder: boolean }[] };
export const BACKFILL_BATCH_SIZE = 12;

const answer = z.object({ claims: z.array(z.object({ ref: z.string(), links: z.array(structureLabelSchema).default([]) })) });
export const backfillAnswerSchema = answer;

const PROMPT = `You label how the stakeholders a claim names sit inside each other and press on each other. Each claim comes with the entities it names, as { type, key, name }.

Answer with JSON only: { "claims": [{ "ref": "C1", "links": [{ "from": { "type", "key" }, "link", "to": { "type", "key" }, "title", "seniority", "share", "current", "since", "until" }] }] }, one item per claim.
- Label only links the claim states. links is [] when it states none; most claims state none.
- from and to are exactly one of THAT claim's entities (same type and key). Never invent an entity.
- link: ${STRUCTURE_LINK_GUIDE}.
- Direction goes from the smaller or lower thing to the bigger: a person or role works_in a company, a team is part_of a company, a company is owned_by its owner, a person leads a team or reports_to a person. A pressure link goes from the one pressing: a regulator regulates a company, a client contracts_with a supplier, a city issues permits it regulates.
- A role (a job like "Designer") at an organization is works_in that organization; a role that approves or issues permits for another party regulates that party only when the claim says it has that authority.
- title: a job title the claim states, or null. seniority: that title on the ladder (${SENIORITY_GUIDE}), or null.
- share: only on owned_by, the stated ownership from 0 to 1 ("sole shareholder" or "wholly owned" is 1); null when not stated.
- current: false only when the claim says the tie has ended. since and until: only stated dates, as "2019", "2021-03" or "2021-03-15"; otherwise null.`;

export function buildBackfillMessages(claims: BackfillClaim[]): ChatMessage[] {
  const payload = claims.map((claim, index) => ({ ref: `C${index + 1}`, claim: claim.content,
    entities: claim.entities.filter((entity) => entity.stakeholder).map(({ type, key, name }) => ({ type, key, name })) }));
  return [{ role: "system", content: PROMPT }, { role: "user", content: JSON.stringify({ claims: payload }) }];
}

// ANSWER -> each claim's labels: both ends among its own entities, no self links, dates kept only
// when they are partial ISO dates, a share only on owned_by, an end date making the link former
export function readBackfill(value: z.infer<typeof answer>, claims: BackfillClaim[]): Map<string, StructureLabel[]> {
  const byRef = new Map(claims.map((claim, index) => [`C${index + 1}`, claim]));
  const labels = new Map<string, StructureLabel[]>();
  for (const item of value.claims) {
    const claim = byRef.get(item.ref.trim().toUpperCase());
    if (!claim || labels.has(claim.unitId)) continue;
    // Only stakeholders take part: a permit, standard or procedure is not inside or over anyone
    const own = new Set(claim.entities.filter((entity) => entity.stakeholder).map((entity) => `${entity.type}:${entity.key}`));
    const date = (text: string | null) => (text && PARTIAL_DATE.test(text.trim()) ? text.trim() : null);
    const seen = new Set<string>();
    const kept = item.links.flatMap((link): StructureLabel[] => {
      const from = { type: link.from.type, key: link.from.key }, to = { type: link.to.type, key: link.to.key };
      const id = `${from.type}:${from.key}|${link.link}|${to.type}:${to.key}`;
      if (!own.has(`${from.type}:${from.key}`) || !own.has(`${to.type}:${to.key}`) || `${from.type}:${from.key}` === `${to.type}:${to.key}` || seen.has(id)) return [];
      seen.add(id);
      const since = date(link.since), until = date(link.until);
      return [{ from, link: link.link, to, title: link.title?.trim() || null, seniority: link.seniority,
        share: link.link === "owned_by" ? link.share : null, current: until ? false : link.current, since, until }];
    });
    labels.set(claim.unitId, kept);
  }
  return labels;
}

// THE BACKFILL: every candidate claim, in batches; returns how many claims and links were written
export async function backfillStructure(client: AdminSupabase, settings: TokenFactorySettings, log: (line: string) => void = () => {}): Promise<{ claims: number; labelled: number; links: number; failed: number }> {
  const db = supabaseRpc(client);
  const claims = await db.call<BackfillClaim[]>("structure_backfill_candidates");
  let labelled = 0, links = 0, failed = 0;
  for (let index = 0; index < claims.length; index += BACKFILL_BATCH_SIZE) {
    const batch = claims.slice(index, index + BACKFILL_BATCH_SIZE);
    const result = await chatJson(settings, { name: "structure_backfill", schema: answer, jsonSchema: z.toJSONSchema(answer), messages: buildBackfillMessages(batch), reasoningEffort: "low" });
    for (const [unitId, labels] of readBackfill(result.value, batch)) {
      if (!labels.length) continue;
      try {
        const written = await db.call<number>("backfill_structure", { p_unit: unitId, p_structure: labels });
        if (written > 0) { labelled += 1; links += written; }
      } catch (error) {
        failed += 1;
        log(`Claim ${unitId} not backfilled: ${error instanceof Error ? error.message : error}`);
      }
    }
    log(`Read ${Math.min(index + BACKFILL_BATCH_SIZE, claims.length)} of ${claims.length} claims`);
  }
  return { claims: claims.length, labelled, links, failed };
}
