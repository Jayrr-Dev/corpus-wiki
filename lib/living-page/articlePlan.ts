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

// Only real claim refs become section queries. Every claim is stated once: the introduction states its own
// claims, and the topic sections hold the rest, so a claim listed in both stays in the introduction alone.
// A topic left with no claims of its own is dropped.
export function articleSections(plan: ArticlePlan, knowledge: ArticleKnowledge): SectionDraft[] {
  const ids = (refs: string[]) => [...new Set(refs.map((ref) => {
    const match = /^C([1-9]\d*)$/.exec(ref.trim());
    const unit = match ? knowledge.units[Number(match[1]) - 1] : undefined;
    if (!unit) throw new Error(`The article outline cited an unknown claim: ${ref}`);
    return unit.unitId;
  }))];
  const entity = { type: knowledge.entity.type, key: knowledge.entity.key };
  const intro = ids(plan.introduction);
  const inIntro = new Set(intro);
  const groups = plan.sections.map((group) => ({ title: group.title.trim(), unitIds: ids(group.claims).filter((id) => !inIntro.has(id)) })).filter((group) => group.unitIds.length);
  const covered = new Set([...intro, ...groups.flatMap((group) => group.unitIds)]);
  const missing = knowledge.units.filter((unit) => !covered.has(unit.unitId));
  if (missing.length) throw new Error(`The article outline omitted ${missing.length} claims (${missing.map((unit) => `C${knowledge.units.indexOf(unit) + 1}`).join(", ")}). Nothing was reorganized.`);
  const titles = groups.map((group) => group.title.toLowerCase());
  if (new Set(titles).size !== titles.length || titles.includes("overview")) throw new Error("The article outline repeated a section heading.");
  return [
    { title: "Overview", query: { entity, unitIds: intro, article: true } },
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

// =====================================================================
// OUTLINE QUALITY: problems worth one correction round, and sentence-case
// headings. Unlike articleSections these never block a page: a second
// outline that still has them is used as it is.
// =====================================================================

const REPEAT_HEADING = /^(overview|introduction|summary|background)\b/i;

// A topic section named like the introduction restates it. (Claims listed in both are kept in the
// introduction alone by articleSections, so a section can no longer repeat them.)
export function outlineProblems(plan: ArticlePlan): string[] {
  return plan.sections.flatMap((section) => (REPEAT_HEADING.test(section.title.trim())
    ? [`"${section.title}" restates the introduction; the introduction is already the overview, so give its other claims to the topic sections they belong to.`]
    : []));
}

// The title and headings in sentence case: the first word capitalized, and a later word kept only when it is an
// acronym, has an inner capital, or the claims or subject name treat it as a proper name
export function sentenceCasePlan(plan: ArticlePlan, knowledge: ArticleKnowledge): ArticlePlan {
  const names = properNames([knowledge.entity.name, ...knowledge.units.map((unit) => unit.content)]);
  const fix = (text: string) => sentenceCase(text, names);
  return { ...plan, title: fix(plan.title), sections: plan.sections.map((section) => ({ ...section, title: fix(section.title) })) };
}

const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu;
const wordBase = (word: string) => word.replace(/['’]s$/u, "");

// Proper names: words capitalized inside a sentence, or capitalized and never written in lower case.
// Every word of the subject name counts. Possessives count as their base word.
export function properNames(sources: string[]): Set<string> {
  const midSentence = new Set<string>(sources[0]?.match(WORD)?.map(wordBase) ?? []);
  const capitalized = new Set<string>();
  const lower = new Set<string>();
  for (const text of sources) {
    for (const match of text.matchAll(WORD)) {
      const word = wordBase(match[0]);
      if (!/^\p{Lu}/u.test(word)) {
        lower.add(word.toLowerCase());
        continue;
      }
      capitalized.add(word);
      const before = text.slice(0, match.index).trimEnd();
      if (before !== "" && !/[.!?:;"“(]$/.test(before)) midSentence.add(word);
    }
  }
  return new Set([...midSentence, ...[...capitalized].filter((word) => !lower.has(word.toLowerCase()))]);
}

export function sentenceCase(text: string, names: ReadonlySet<string>): string {
  let first = true;
  return text.trim().replace(WORD, (word) => {
    if (first) {
      first = false;
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    const acronym = word.length > 1 && word === word.toUpperCase();
    const innerCapital = /\p{Ll}\p{Lu}/u.test(word);
    return acronym || innerCapital || names.has(wordBase(word)) ? word : word.toLowerCase();
  });
}
