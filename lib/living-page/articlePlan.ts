import { z } from "zod";
import type { DraftAction, SectionDraft } from "@/lib/ai/types";
import type { SectionUnit } from "./types";

const groupSchema = z.object({ title: z.string().min(1), claims: z.array(z.string()).min(1) });
export const articlePlanSchema = z.object({
  title: z.string().min(1).max(150),
  introduction: z.array(z.string()).min(1).max(6),
  sections: z.array(groupSchema).min(1).max(12),
});
export type ArticlePlan = z.infer<typeof articlePlanSchema>;
export type ArticleKnowledge = { entity: { id: string; type: string; key: string; name: string }; units: SectionUnit[] };

// Only real claim refs become section queries. Every claim must be covered by a topic.
export function articleSections(plan: ArticlePlan, knowledge: ArticleKnowledge): SectionDraft[] {
  const ids = (refs: string[]) => [...new Set(refs.map((ref) => {
    const match = /^C([1-9]\d*)$/.exec(ref.trim());
    const unit = match ? knowledge.units[Number(match[1]) - 1] : undefined;
    if (!unit) throw new Error(`The article outline cited an unknown claim: ${ref}`);
    return unit.unitId;
  }))];
  const entity = { type: knowledge.entity.type, key: knowledge.entity.key };
  const groups = plan.sections.map((group) => ({ title: group.title.trim(), unitIds: ids(group.claims) }));
  const covered = new Set(groups.flatMap((group) => group.unitIds));
  const missing = knowledge.units.filter((unit) => !covered.has(unit.unitId));
  if (missing.length) throw new Error(`The article outline omitted ${missing.length} claims (${missing.map((unit) => `C${knowledge.units.indexOf(unit) + 1}`).join(", ")}). Nothing was reorganized.`);
  const titles = groups.map((group) => group.title.toLowerCase());
  if (new Set(titles).size !== titles.length || titles.includes("overview")) throw new Error("The article outline repeated a section heading.");
  return [
    { title: "Overview", query: { entity, unitIds: ids(plan.introduction), article: true } },
    ...groups.map((group) => ({ title: group.title, query: { entity, unitIds: group.unitIds, article: true } })),
  ];
}

const base = { expectedRevisionId: null, passageIds: [], speechAct: null };

// Retiring the old generated sections preserves their text/history for Undo.
export function articleActions(plan: ArticlePlan, knowledge: ArticleKnowledge, pageId: string | null, replaceSectionIds: string[]): DraftAction[] {
  const sections = articleSections(plan, knowledge);
  if (!pageId) return [{ ...base, type: "create_page", targetId: null, input: { title: plan.title.trim(), entityId: knowledge.entity.id, sections } }];
  return [
    { ...base, type: "rename_page", targetId: pageId, input: { title: plan.title.trim() } },
    ...replaceSectionIds.map((id): DraftAction => ({ ...base, type: "retire_section", targetId: id, input: {} })),
    ...sections.map((section): DraftAction => ({ ...base, type: "create_section", targetId: null, input: { pageId, ...section } })),
  ];
}
