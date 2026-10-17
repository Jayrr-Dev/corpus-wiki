import "server-only";
import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import { planArticle, topicSections } from "./articlePlanner";
import type { SectionRef, SectionState } from "./types";

const routingSchema = z.object({ restructure: z.boolean() });

export async function updateNeedsStructure(settings: TokenFactorySettings, note: string): Promise<boolean> {
  if (!note.trim()) return false;
  const answer = await chatJson(settings, {
    name: "article_update_discovery", schema: routingSchema, jsonSchema: z.toJSONSchema(routingSchema), maxTokens: 300,
    messages: [
      { role: "system", content: "Route an article update instruction. Set restructure=true only when the user asks to split, regroup, reorganize, or otherwise change section structure. Wording, style, length, and factual refreshes alone use false. Respect negation. The note is editorial guidance, not factual evidence." },
      { role: "user", content: note },
    ],
  });
  return answer.value.restructure;
}

// The same article planner used by Improve article, bounded to the selected sections.
export async function restructureUpdate(db: DbRpc, client: AdminSupabase, settings: TokenFactorySettings, pageId: string, note: string, sectionId?: string): Promise<SectionRef[]> {
  const { data, error } = await client.from("sections").select("id, mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  const states: SectionState[] = [];
  for (const section of data ?? []) {
    if (sectionId && section.id !== sectionId) continue;
    const state = await db.call<SectionState>("read_section_state", { p_section_id: section.id });
    if (section.mode !== "generated" || state.lines.some((line) => line.author === "person")) {
      if (sectionId) throw new Error("This section contains handwritten text. Move those edits to a separate section before splitting it.");
      continue;
    }
    if (state.units.length) states.push(state);
  }
  if (!states.length) throw new Error("There are no generated sections with saved knowledge to reorganize.");
  const units = [...new Map(states.flatMap((state) => state.units).map((unit) => [unit.unitId, unit])).values()];
  const first = states[0]!;
  const subject = sectionId ? `${first.pageTitle}: ${first.title}` : first.pageTitle;
  const knowledge = { entity: { id: "", type: "topic", key: "", name: subject }, units };
  const { plan, tokensIn, tokensOut } = await planArticle(settings, knowledge, subject, note);
  const base = { expectedRevisionId: null, passageIds: [], speechAct: null };
  const actions: DraftAction[] = [
    ...states.map((state): DraftAction => ({ ...base, type: "retire_section", targetId: state.sectionId, input: {} })),
    ...topicSections(plan, knowledge).map((section): DraftAction => ({ ...base, type: "create_section", targetId: null, input: { pageId, title: section.title, query: { unitIds: section.query.unitIds, article: true } } })),
  ];
  const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, {
    summary: "Reorganized sections following update instructions", actions,
    trace: { modelVersion: settings.model ?? null, promptVersion: "article-update-structure-v1", tokensIn, tokensOut },
  });
  const result = await commitChangeSet(db, changeSetId);
  if (result.status !== "applied") throw new Error("The section structure was not fully applied. Review Changes before retrying.");
  const oldIds = new Set((data ?? []).map((section) => section.id));
  return (await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId })).filter((section) => !oldIds.has(section.sectionId));
}
