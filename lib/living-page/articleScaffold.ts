import { addUsage, type TokenFactorySettings } from "@/lib/ai/chat";
import type { DraftAction, SectionDraft } from "@/lib/ai/types";
import { commitChangeSet, revertChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import "server-only";
import { articleSections } from "./articlePlan";
import { planArticle, topicSections } from "./articlePlanner";
import { selectArticleScope } from "./articleScope";
import { finishArticleStructure, readArticleStructure, saveArticleStructure, type ArticleStructureSection } from "./articleStructureMemory";
import { rebuildUploadSection, type SectionWriter } from "./index";
import { needsRewrite } from "./plan";
import type { SectionState, SectionUnit } from "./types";
import { readArticleJudgments, rememberedJudgment, saveArticleJudgments, scopeBasis } from "./articleJudgments";

export type ExistingScaffoldSection = { state: SectionState; position: number; protected: boolean; query?: unknown };
export type KeptScaffoldSection = ExistingScaffoldSection & { plannedUnitIds: string[] };
export type ScaffoldChanges = { keep: KeptScaffoldSection[]; replace: ExistingScaffoldSection[]; create: (SectionDraft & { position: number })[] };
const sameIds = (a: string[], b: string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
// Same subject: at least half of what the section cites stays in the plan.
const sameSubject = (current: string[], planned: string[]) => {
  if (sameIds(current, planned)) return true;
  const ids = new Set(planned);
  const unique = [...new Set(current)];
  return unique.length > 0 && unique.filter(id => ids.has(id)).length * 2 >= unique.length;
};
function canonical(value: unknown): unknown {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
}

// Diff the reviewed whole-article plan against what exists. A same-title section
// stays when at least half its claims stay: added claims are uncovered and
// removed claims flag the lines that cite them. Retire it only when the heading
// is gone or the claims are a different subject. Reordered sections are targeted replacements.
export function scaffoldChanges(existing: ExistingScaffoldSection[], planned: SectionDraft[]): ScaffoldChanges {
  const kept = new Set<string>();
  const plannedIds = new Map<string, string[]>();
  let previousPosition = -Infinity;
  const matches = planned.map(section => {
    const nextIds = section.query.unitIds ?? [];
    const match = existing.find(old => !old.protected && !kept.has(old.state.sectionId)
      && old.position > previousPosition && old.state.title === section.title
      && sameSubject(old.state.units.map(unit => unit.unitId), nextIds));
    if (match) { kept.add(match.state.sectionId); plannedIds.set(match.state.sectionId, nextIds); previousPosition = match.position; }
    return match;
  });
  let inserted = 0;
  const end = Math.max(-1, ...existing.map(section => section.position)) + 1;
  const create = planned.flatMap((section, index) => {
    if (matches[index]) return [];
    const next = matches.slice(index + 1).find(Boolean);
    return [{ ...section, position: (next?.position ?? end) + inserted++ }];
  });
  return { keep: existing.filter(section => section.protected || kept.has(section.state.sectionId)).map(section => ({
    ...section, plannedUnitIds: plannedIds.get(section.state.sectionId) ?? section.state.units.map(unit => unit.unitId),
  })), replace: existing.filter(section => !section.protected && !kept.has(section.state.sectionId)), create };
}

export async function loadScaffoldUnits(client: AdminSupabase, ids: string[]): Promise<SectionUnit[]> {
  const readUnits = (selected: string[]) => readIdBatches(selected, batch => readPages((from, to) => client.from("units").select("id,current_revision_id,kind,epistemic_status").in("id", batch).is("retired_at", null).order("id").range(from, to)));
  const readRevisions = (selected: string[]) => readIdBatches(selected, batch => readPages((from, to) => client.from("revisions").select("id,content,knowledge_context,structure").in("id", batch).order("id").range(from, to)));
  const units = await readUnits(ids);
  const revisions = await readRevisions(units.map(unit => unit.current_revision_id));
  const composites = new Set(revisions.filter(revision => revision.structure != null).map(revision => revision.id));
  const parents = units.filter(unit => composites.has(unit.current_revision_id)).map(unit => unit.id);
  // Match read_section_state's one-level composite expansion BEFORE planning.
  // Otherwise the writer discovers unplanned required members only after the
  // approved outline has already excluded their subject or level range.
  const members = await readIdBatches(parents, batch => readPages((from, to) => client.from("relationships")
    .select("from_unit_id,to_unit_id,position").eq("type", "part_of").in("to_unit_id", batch).is("retired_at", null).order("id").range(from, to)));
  const present = new Set(units.map(unit => unit.id));
  const added = await readUnits([...new Set(members.map(member => member.from_unit_id))].filter(id => !present.has(id)));
  units.push(...added);
  revisions.push(...await readRevisions(added.map(unit => unit.current_revision_id)));
  const revisionOf = new Map(revisions.map(revision => [revision.id, revision]));
  return units.map(unit => {
    const revision = revisionOf.get(unit.current_revision_id);
    const member = members.find(link => link.from_unit_id === unit.id);
    return { unitId: unit.id, revisionId: unit.current_revision_id, kind: unit.kind, epistemicStatus: unit.epistemic_status,
      content: revision?.content ?? "", context: parseKnowledgeContext(revision?.knowledge_context),
      ...(revision?.structure ? { structure: revision.structure as SectionUnit["structure"] } : {}),
      ...(member ? { memberOf: member.to_unit_id, position: member.position } : {}),
    };
  });
}

const base = { expectedRevisionId: null, passageIds: [], speechAct: null };

// Coverage discovery selects evidence, not the final section boundaries. Review
// one coherent scaffold using ALL existing and newly selected knowledge before
// writing. Existing manual/illustrated sections are fixed context.
export async function prepareArticleScaffold(db: DbRpc, client: AdminSupabase, settings: TokenFactorySettings,
  pageId: string, additions: SectionDraft[], note: string, progress?: (detail: string) => void) {
  const { data: page, error: pageError } = await client.from("pages").select("title,scope").eq("id", pageId).single();
  if (pageError) throw new Error(pageError.message);
  const { data: rows, error } = await client.from("sections").select("id,mode,position,query").eq("page_id", pageId).is("retired_at", null).order("position");
  if (error) throw new Error(error.message);
  let existing: ExistingScaffoldSection[] = [];
  for (const row of rows ?? []) {
    const state = await db.call<SectionState>("read_section_state", { p_section_id: row.id });
    const protectedSection = row.mode !== "generated" || state.lines.some(line => line.author === "person")
      || (!state.units.length && state.lines.some(line => line.content.trim()))
      || await db.call<boolean>("composer_section_has_images", { p_section_id: row.id });
    existing.push({ state, position: row.position, protected: protectedSection, query: row.query ?? null });
  }
  const editable = existing.filter(section => !section.protected);
  const extra = await loadScaffoldUnits(client, additions.flatMap(section => section.query.unitIds ?? []));
  let units = [...new Map([...editable.flatMap(section => section.state.units), ...extra].map(unit => [unit.unitId, unit])).values()];
  progress?.("Reconciling selected evidence with the article scope…");
  const basis = scopeBasis(page.title, page.scope);
  const judgments = await readArticleJudgments(db, pageId);
  const scoped = await selectArticleScope(settings, page.title, page.scope, units,
    unit => rememberedJudgment(judgments, "scope", unit.unitId, unit.revisionId, basis)?.decision as "in_scope" | "outside_scope" | undefined);
  await saveArticleJudgments(db, pageId, "scope", scoped.judged.map(item => ({ subject: item.unitId, revisionId: item.revisionId, basis, decision: item.decision, reason: item.reason })));
  const excluded = new Set(scoped.excludedIds);
  // Keep an old mixed section whole; selection cannot remove its saved text.
  existing = existing.map(section => section.state.units.some(unit => excluded.has(unit.unitId)) ? { ...section, protected: true } : section);
  const frozenUnits = new Set(existing.filter(section => section.protected).flatMap(section => section.state.units.map(unit => unit.unitId)));
  units = units.filter(unit => !excluded.has(unit.unitId) && !frozenUnits.has(unit.unitId));
  if (!units.length) return { changes: { keep: existing.map(section => ({ ...section, plannedUnitIds: section.state.units.map(unit => unit.unitId) })), replace: [], create: [] }, rationale: "Keep saved sections; no selected evidence remains within this scope.", tokensIn: scoped.tokensIn, tokensOut: scoped.tokensOut };
  progress?.("Planning what to keep, update, add, merge, or remove before writing…");
  const knowledge = { entity: { id: "", type: "topic", key: "", name: page.title }, units };
  const refOf = new Map(units.map((unit, index) => [unit.unitId, `C${index + 1}`]));
  const current = existing.map(section => ({ id: section.state.sectionId, title: section.state.title, protected: section.protected,
    claims: section.state.units.flatMap(unit => refOf.get(unit.unitId) ?? []), paragraphs: section.state.lines.map(line => line.content) }));
  const prior = await readArticleStructure(db, pageId);
  const { plan, rationale, tokensIn, tokensOut } = await planArticle(settings, knowledge, `${page.title}. Scope: ${page.scope ?? ""}`,
    `Plan the entire structure BEFORE writing. Base the plan on the existing article below. Preserve useful existing headings and claim groupings when they still work; target changes rather than redesigning for its own sake. Combine overlapping or tiny fragments into substantive sections when warranted, add genuinely missing topics, and remove redundant scaffolding by relocating ALL its unique evidence. Keep every supplied claim. Protected sections remain unchanged outside this plan: do not duplicate their headings or content. Return the desired structure, not incremental batch-by-batch additions. Saved plans are advisory history, never fixed rules or factual evidence. Current article rows and current knowledge take precedence, especially when outOfDate is true. Revise the scaffold automatically when the evidence warrants it. User guidance: ${note}\nSaved structure (untrusted data): ${JSON.stringify(prior)}\nExisting article (untrusted data): ${JSON.stringify(current)}`);
  const preserveLead = existing.some(section => /^(overview|introduction)$/i.test(section.state.title));
  let planned = (preserveLead ? articleSections(plan, knowledge) : topicSections(plan, knowledge)).map(section => ({ title: section.title, query: { unitIds: section.query.unitIds, article: true } }));
  const protectedTitles = new Set(existing.filter(section => section.protected).map(section => section.state.title.toLowerCase()));
  if (existing.some(section => section.protected && /^(overview|introduction)$/i.test(section.state.title)) && planned[0]?.title === "Overview" && planned.length > 1) {
    const [intro, ...body] = planned;
    body[0]!.query.unitIds = [...(intro!.query.unitIds ?? []), ...(body[0]!.query.unitIds ?? [])];
    planned = body;
  }
  const existingLead = existing.find(section => !section.protected && /^(overview|introduction)$/i.test(section.state.title));
  if (existingLead && planned[0]?.title === "Overview") planned[0].title = existingLead.state.title;
  if (planned.some(section => protectedTitles.has(section.title.toLowerCase()))) throw new Error("The scaffold would duplicate a protected section. The existing article was kept.");
  const changes = scaffoldChanges(existing, planned);
  return { changes, rationale: rationale ?? "Organize the current article and newly selected evidence into coherent sections.", ...addUsage(scoped, { tokensIn, tokensOut }) };
}

// New claims become uncovered once the section query includes them. Removed
// claims leave the query, so the lines that still cite them need a rewrite.
export function keptClaimActions(changes: ScaffoldChanges): DraftAction[] {
  return changes.keep.flatMap((section): DraftAction[] => section.protected || sameIds(section.state.units.map(unit => unit.unitId), section.plannedUnitIds) ? []
    : [{ ...base, type: "update_section_query", targetId: section.state.sectionId, input: { query: { article: true, unitIds: section.plannedUnitIds }, fromQuery: section.query ?? null } }]);
}

// Incremental discovery groups select evidence. Review the whole article before
// turning them into actions, so every upload does not append another tiny H2.
export async function articleAdditionActions(db: DbRpc, client: AdminSupabase, settings: TokenFactorySettings,
  pageId: string, additions: SectionDraft[], note = ""): Promise<DraftAction[]> {
  if (!additions.length) return [];
  const { changes } = await prepareArticleScaffold(db, client, settings, pageId, additions, note);
  return [
    ...keptClaimActions(changes),
    ...changes.replace.map((section): DraftAction => ({ ...base, type: "retire_section", targetId: section.state.sectionId, input: {} })),
    ...changes.create.map((section): DraftAction => ({ ...base, type: "create_section", targetId: null, input: { pageId, ...section } })),
  ];
}

// NO-OP GUARD: with no new evidence, no guidance and nothing stale, re-planning the
// article would only re-outline what it already says (and reshuffle sections).
// An unfinished saved plan still resumes, so a half-applied scaffold is completed.
async function hasPendingStructureWork(db: DbRpc, client: AdminSupabase, pageId: string): Promise<boolean> {
  if ((await readArticleStructure(db, pageId)).planned) return true;
  const { data: rows, error } = await client.from("sections").select("id,mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  for (const row of rows ?? []) {
    if (row.mode === "generated" && needsRewrite(await db.call<SectionState>("read_section_state", { p_section_id: row.id }))) return true;
  }
  return false;
}

export async function applyArticleScaffold(db: DbRpc, client: AdminSupabase, settings: TokenFactorySettings, writer: SectionWriter,
  pageId: string, additions: SectionDraft[], note = "", progress?: (detail: string) => void): Promise<{ changed: number; sectionIds: string[] }> {
  if (!additions.length && !note.trim() && !await hasPendingStructureWork(db, client, pageId)) return { changed: 0, sectionIds: [] };
  const intent = createHash("sha256").update(JSON.stringify(canonical({ pageId, note, units: additions.flatMap(section => section.query.unitIds ?? []).sort() }))).digest("hex");
  const { changes, rationale, tokensIn, tokensOut } = await workflowStep(`article-scaffold:${intent}:plan-v5-claims`, () => prepareArticleScaffold(db, client, settings, pageId, additions, note, progress));
  const snapshot = createHash("sha256").update(JSON.stringify(canonical(changes))).digest("hex");
  const articleScaffold = { keepSectionIds: changes.keep.map(section => section.state.sectionId), replaceSectionIds: changes.replace.map(section => section.state.sectionId),
    sections: changes.create.map(section => ({ title: section.title, unitIds: section.query.unitIds ?? [], position: section.position })) };
  progress?.(`Structure planned: keep ${changes.keep.length} sections, replace or merge ${changes.replace.length}, and write ${changes.create.length}.`);
  const projected: ArticleStructureSection[] = [...changes.keep.map(section => ({ section, unitIds: section.plannedUnitIds })), ...changes.replace.map(section => ({ section, unitIds: section.state.units.map(unit => unit.unitId) }))]
    .map(({ section, unitIds }) => ({ sectionId: section.state.sectionId, title: section.state.title, position: section.position, unitIds, protected: section.protected }));
  for (const section of changes.create) {
    for (const old of projected) if (old.position >= section.position) old.position++;
    projected.push({ sectionId: null, title: section.title, position: section.position, unitIds: section.query.unitIds ?? [] });
  }
  const replacedIds = new Set(articleScaffold.replaceSectionIds);
  const structure = projected.filter(section => !section.sectionId || !replacedIds.has(section.sectionId)).sort((a, b) => a.position - b.position);
  const savedPlanId = await saveArticleStructure(db, { pageId, key: snapshot, structure, changes: articleScaffold, rationale, model: settings.model ?? null });
  const finishSavedPlan = async () => finishArticleStructure(db, savedPlanId, "applied", (await readArticleStructure(db, pageId)).current);
  // Kept sections take their planned claims before anything is created or retired,
  // so a claim moving out of a replaced section always has a live home.
  const claimActions = keptClaimActions(changes);
  const assignKeptClaims = () => claimActions.length ? workflowStep(`article-scaffold:${pageId}:${snapshot}:claims`, async () => {
    for (const action of claimActions) {
      const planned = changes.keep.find(section => section.state.sectionId === action.targetId)!;
      const latest = await db.call<SectionState>("read_section_state", { p_section_id: planned.state.sectionId });
      if (JSON.stringify(canonical(latest)) !== JSON.stringify(canonical(planned.state))) throw new Error("The article changed during planning. The edited section was kept; run the update again.");
    }
    const draft = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai", operationKey: `article-scaffold:${pageId}:${snapshot}:claims` }, {
      summary: "Updated the claims of sections the reviewed scaffold keeps",
      actions: claimActions,
      trace: { modelVersion: settings.model ?? null, promptVersion: "article-scaffold-v3-keep", tokensIn: 0, tokensOut: 0, articleScaffold },
    });
    const committed = await commitChangeSet(db, draft.changeSetId);
    if (committed.status !== "applied" || committed.rejected > 0 || committed.exceptions > 0) throw new Error("The kept sections' claims could not be updated. The previous article was kept.");
    return draft.changeSetId;
  }) : Promise.resolve(null);
  const replacedTitles = new Set(changes.replace.map(section => section.state.title));
  // Replaced sections are about to go; the writer must not omit a moved claim because an old section still states it.
  const contextWriter: SectionWriter = { ...writer, name: writer.name, promptVersion: writer.promptVersion,
    reviseSection: (input, reporter) => writer.reviseSection({ ...input, ...(note.trim() ? { updateNote: note } : {}), pageContext: input.pageContext?.filter(section => !replacedTitles.has(section.section)) }, reporter) };
  let claimsId: string | null = null;
  const keptBuilt: string[] = [];
  const finishKept = async () => {
    for (const section of changes.keep) if (!section.protected) {
      const rewritten = await workflowStep(`article-scaffold:${pageId}:${snapshot}:kept:${section.state.sectionId}`, async () => {
        const current = await db.call<SectionState>("read_section_state", { p_section_id: section.state.sectionId });
        if (!needsRewrite(current)) return false;
        const built = await rebuildUploadSection(db, contextWriter, section.state.sectionId, null);
        if (!built || built.rebuildRequested) throw new Error("An existing section is still being updated. Retry after writing finishes.");
        return true;
      });
      if (rewritten) keptBuilt.push(section.state.sectionId);
    }
    return keptBuilt;
  };
  // Outside an upload nothing resumes, so claims nobody has written yet go back to their old sections.
  const undoClaims = async (errors: unknown[]) => {
    if (claimsId && !keptBuilt.length && !uploadExecution.getStore()) await revertChangeSet(db, claimsId).catch(failure => errors.push(failure));
  };
  if (!changes.create.length && !changes.replace.length) {
    try {
      claimsId = await assignKeptClaims();
      const built = await finishKept();
      await finishSavedPlan();
      return { changed: built.length, sectionIds: built };
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      await undoClaims(rollbackErrors);
      if (!uploadExecution.getStore()) await finishArticleStructure(db, savedPlanId, "failed").catch(failure => rollbackErrors.push(failure));
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "The scaffold update failed and could not be fully undone. Review its changes before retrying.");
      throw error;
    }
  }
  let creationId: string | null = null;
  const newIds: string[] = [];
  const published = new Set<string>();
  const publishedUnits = new Set(changes.keep.flatMap(section => section.state.units.map(unit => unit.unitId)));
  const retiredIds = new Set<string>();
  if (changes.replace.length) {
    // A cached plan may outlive a partly applied retirement from an earlier
    // worker. Retiring those rows again fails action checks and loops forever.
    const { data: priorRows, error } = await client.from("sections").select("id,retired_at")
      .eq("page_id", pageId).in("id", changes.replace.map(section => section.state.sectionId));
    if (error) throw new Error(error.message);
    for (const row of priorRows ?? []) if (row.retired_at) retiredIds.add(row.id);
  }
  const retireCovered = async (finished = false) => {
    for (const old of changes.replace) {
      if (retiredIds.has(old.state.sectionId)) continue;
      if (!finished && (!old.state.units.length || !old.state.units.every(unit => publishedUnits.has(unit.unitId)))) continue;
      await workflowStep(`article-scaffold:${pageId}:${snapshot}:published:${old.state.sectionId}`, async () => {
        const latest = await db.call<SectionState>("read_section_state", { p_section_id: old.state.sectionId });
        if (JSON.stringify(canonical(latest)) !== JSON.stringify(canonical(old.state))) throw new Error("The article changed during planning. Completed sections are saved; the edited previous section was kept.");
        const retired = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai", operationKey: `article-scaffold:${pageId}:${snapshot}:retire:${old.state.sectionId}` }, {
          summary: "Published a completed section and replaced its previous fragments",
          actions: [{ ...base, type: "retire_section", targetId: old.state.sectionId, input: {} }],
          trace: { modelVersion: settings.model ?? null, promptVersion: "article-scaffold-v2-progressive", tokensIn: 0, tokensOut: 0, articleScaffold },
        });
        const committed = await commitChangeSet(db, retired.changeSetId);
        if (committed.status !== "applied" || committed.rejected > 0 || committed.exceptions > 0) throw new Error("Completed sections are saved, but previous section cleanup needs to resume.");
      });
      retiredIds.add(old.state.sectionId);
    }
  };
  try {
    claimsId = await assignKeptClaims();
    if (changes.create.length) {
      const draft = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai", operationKey: `article-scaffold:${pageId}:${snapshot}:create` }, {
        summary: "Prepared targeted sections from the reviewed article scaffold",
        actions: changes.create.map((section): DraftAction => ({ ...base, type: "create_section", targetId: null, input: { pageId, ...section } })),
        trace: { modelVersion: settings.model ?? null, promptVersion: "article-scaffold-v1", tokensIn, tokensOut, articleScaffold },
      });
      creationId = draft.changeSetId;
      const committed = await commitChangeSet(db, creationId);
      if (committed.status !== "applied" || committed.rejected > 0 || committed.exceptions > 0) throw new Error("The article scaffold was not fully applied.");
      const { data: created, error: createdError } = await client.from("actions").select("target_id").eq("change_set_id", creationId).eq("type", "create_section").eq("outcome", "applied").order("position");
      if (createdError) throw new Error(createdError.message);
      newIds.push(...(created ?? []).flatMap(action => action.target_id ? [action.target_id] : []));
      if (newIds.length !== changes.create.length) throw new Error("The planned section list is incomplete. The previous article was kept.");
      for (const sectionId of newIds) {
        progress?.(`Publishing section ${published.size + 1} of ${newIds.length} as it finishes…`);
        const saved = await workflowStep(`article-scaffold:${pageId}:${snapshot}:written:${sectionId}`, async () => {
          const built = await rebuildUploadSection(db, contextWriter, sectionId, null);
          if (!built || built.rebuildRequested) throw new Error("A planned section is still being written. Completed sections are saved.");
          const state = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
          if (!state.lines.some(line => line.content.trim())) throw new Error("A planned section has no text. Completed sections are saved.");
          return { unitIds: state.units.map(unit => unit.unitId) };
        });
        published.add(sectionId);
        for (const unitId of saved.unitIds) publishedUnits.add(unitId);
        await retireCovered();
        progress?.(`Published ${published.size} of ${newIds.length} sections.`);
      }
    }
    // Kept sections write their moved-in claims before the sections they came from retire.
    const builtKept = await finishKept();
    await retireCovered(true);
    await finishSavedPlan();
    return { changed: changes.create.length + changes.replace.length + builtKept.length, sectionIds: [...newIds, ...builtKept] };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    // Published sections remain durable even when later writing fails. Upload
    // retries also keep unfinished drafts under the original operation key.
    if (creationId && !published.size && !uploadExecution.getStore()) await revertChangeSet(db, creationId).catch(failure => rollbackErrors.push(failure));
    if (!published.size) await undoClaims(rollbackErrors);
    if (!uploadExecution.getStore()) await finishArticleStructure(db, savedPlanId, "failed").catch(failure => rollbackErrors.push(failure));
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "The scaffold update failed and could not be fully undone. Review its changes before retrying.");
    throw error;
  }
}
