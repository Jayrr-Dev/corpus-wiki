import { persistentComposerCache } from "./cache";
import "server-only";
import { runComposerClaim, type ComposerClaim } from "./jobs";
import { composerVisualTaste } from "./visualTaste";
import { loadComposerImage } from "./loadImage";
import { composerWebImages, saveWebImage } from "./importImages";
import { composerImageGenerator } from "./generate";
import type { DbRpc } from "@/lib/db/rpc";
import { readModelChoice } from "@/lib/ai/models";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { reviewedComposition, type ComposerAttempt } from "./review";
import { validateSvg } from "./svg";
import type { ComposerRun, ShownIllustration } from "./types";

type ComposerOptions = { model?: string; feedback?: string; targetParagraphIds?: string[]; onAttempt?: (attempt: ComposerAttempt) => Promise<void> };
export async function composeLivePage(db: DbRpc, pageId: string, options: ComposerOptions = {}) {
  const claim = await db.call<ComposerClaim | null>("claim_composer_job", { p_page_id: pageId, p_automatic: false });
  if (!claim) return { runId: null, figures: 0, message: "Composer is already working on this article, or it has no text yet." };
  return runComposerClaim(db, claim, (guard) => composeClaimedPage(db, claim, options, guard));
}
export async function composeNextAutomatic(db: DbRpc): Promise<boolean> {
  const claim = await db.call<ComposerClaim | null>("claim_composer_job", { p_automatic: true });
  if (!claim) return false;
  await runComposerClaim(db, claim, (guard) => composeClaimedPage(db, claim, {}, guard));
  return true;
}
async function composeClaimedPage(db: DbRpc, claim: ComposerClaim, options: ComposerOptions, guard: () => Promise<void>) {
  const pageId = claim.pageId;
  const snapshot = claim.snapshot;
  if (!snapshot?.paragraphs.length) throw new Error("This article has no text to illustrate.");
  const current = await db.call<ComposerRun | null>("read_composer_run", { p_page_id: pageId });
  const existing = current ?? await db.call<ComposerRun | null>("read_composer_reusable_run", { p_page_id: pageId });
  const choice = await readModelChoice(db);
  if (options.model) choice.roleModels = { ...choice.roleModels, composer: options.model, reviewer: options.model };
  const settings = tokenFactoryFromEnv(process.env, choice, (call) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("Configure the AI provider before using Composer.");
  // Keep the tested visual-review quality without changing the workspace's other reviews.
  // An explicitly selected Reviewer model still wins; otherwise use Composer's model.
  if (!settings.roleRoutes?.reviewer && settings.roleRoutes?.composer) settings.roleRoutes = { ...settings.roleRoutes, reviewer: settings.roleRoutes.composer };
  settings.roleEfforts = { ...settings.roleEfforts, composer: settings.roleEfforts?.composer ?? "low", reviewer: settings.roleEfforts?.reviewer ?? "low" };
  settings.roleInstructions = await loadRoleInstructions(db);
  const target = options.targetParagraphIds;
  if (target && (!target.length || target.some((id) => !snapshot.paragraphs.some((p) => p.id === id)))) throw new Error("This section changed or has no text. Reload and try again.");
  const retained = target ? (existing?.composition.figures ?? []).filter((f) => !target.includes(f.after)) : options.feedback ? [] : existing?.composition.figures ?? [];
  const saveRetained = async (message: string) => {
    await guard();
    const runId = await db.call<string>("save_composer_run_checked", { p_page_id: pageId, p_snapshot: snapshot, p_composition: { figures: retained, omitted: message }, p_review: { retained: true }, p_model: existing!.model, p_expected_run_id: current?.id ?? null });
    return { runId, figures: 0, message };
  };
  if (retained.length >= 3 && !current) return saveRetained("Kept three unchanged illustrations.");
  if (retained.length >= 3) return { runId: existing?.id ?? null, figures: 0, message: "This article has reached Composer's three-illustration limit." };
  const excluded = new Set(target ? (existing?.composition.figures ?? []).filter((f) => target.includes(f.after)).flatMap((f) => f.assetId ? [f.assetId] : []) : []);
  if (target) {
    for (const id of await db.call<string[]>("composer_section_asset_ids", { p_line_ids: target })) excluded.add(id);
    const priorSvgs = existing?.composition.figures.filter((f) => target.includes(f.after) && f.svg).map((f) => f.svg) ?? [];
    if (priorSvgs.length) for (const id of await db.call<string[]>("composer_assets_for_svgs", { p_svgs: priorSvgs })) excluded.add(id);
  }
  const availableAssets = (await db.call<import("./compose").ComposerAsset[]>("composer_asset_library")).filter((a) => !excluded.has(a.id));
  const article = { webImageSearchAvailable: true, imageGenerationAvailable: Boolean(process.env.OPENROUTER_API_KEY), availableAssets, title: snapshot.title, sourceUrl: `/p/${snapshot.slug}`, paragraphs: snapshot.paragraphs, newFigureBudget: target ? 1 : 3 - retained.length, manualPlacementIds: target, replacingFigures: target ? existing?.composition.figures.filter((f) => target.includes(f.after)) : undefined, existingFigures: [...snapshot.paragraphs.filter((p) => p.hasMedia).map((p) => ({ after: p.id, learningGoal: p.text })), ...retained.map((f) => ({ after: f.after, learningGoal: f.learningGoal }))] };
  // A new reviewed batch replaces this role's prior batch; source figures remain untouched.
  const previous = target ? existing ? { ...existing.composition, figures: existing.composition.figures.filter((f) => target.includes(f.after)) } : undefined : options.feedback ? existing?.composition : undefined;
  const generator = composerImageGenerator(pageId, undefined, undefined, guard);
  const cache = persistentComposerCache(db);
  const visuals = composerVisualTaste(settings, { cache, guard, loadAsset: loadComposerImage });
  const webImages = composerWebImages(guard, undefined, async (image) => {
    const asset = await saveWebImage(image, await visuals.file(image));
    visuals.registerAsset(asset.id, image);
    return asset;
  }, visuals.assess, cache);
  const result = await reviewedComposition(settings, article, { inspectComposition: visuals.review, feedback: options.feedback, previous, onAttempt: options.onAttempt, prepareComposition: generator.prepare, toolsForArticle: (selected) => [...webImages.tools(selected), ...(process.env.OPENROUTER_API_KEY ? [generator.tool(selected), generator.tool(selected, true)] : [])] });
  if (!result.attempt && retained.length && !current) return saveRetained(result.composition.omitted);
  if (!result.attempt) return { runId: existing?.id ?? null, figures: 0, message: result.composition.omitted, selection: result.selection };
  result.composition.figures = [...retained, ...result.composition.figures];
  if (result.composition.figures.length > 3) throw new Error("Composer exceeded the article's illustration budget.");
  const problems = result.composition.figures.flatMap((f) => f.assetId ? [] : validateSvg(f.svg));
  if (problems.length) throw new Error(problems.join(" "));
  const published = [...generator.created, ...webImages.created].filter((id) => result.composition.figures.some((f) => f.assetId === id));
  await guard();
  await generator.publish(published);
  let runId: string;
  try { runId = await db.call<string>("save_composer_run_checked", { p_page_id: pageId, p_snapshot: snapshot, p_composition: result.composition, p_review: { ...result.attempt.review, visual: result.attempt.visual, selection: result.selection }, p_model: result.attempt.model, p_expected_run_id: current?.id ?? null }); } catch (error) { await generator.hide(published); throw error; }
  return { runId, figures: result.composition.figures.length - retained.length, total: result.attempt.total, selection: result.selection };
}

export function shownIllustrations(run: ComposerRun | null): ShownIllustration[] {
  return run?.composition.figures.map((f, index) => ({ id: `${run.id}:${index}`, pageId: run.page_id, after: f.after, caption: f.caption, alt: f.alt, learningGoal: f.learningGoal, evidence: f.evidence, assetType: f.assetType, assetId: f.assetId,
    src: `/api/composer/${run.page_id}/${run.id}/${index}` })) ?? [];
}
