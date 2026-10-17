// Explicitly synthetic fixtures: test media choice without adding filler to a real article.
import { createServer } from "vite";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": process.cwd(), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const { reviewedComposition } = await runtime.ssrLoadModule("/lib/composer/review.ts");
  const db = supabaseRpc(getAdminSupabase());
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db));
  if (!settings) throw new Error("AI is not configured.");
  settings.roleRoutes = { ...settings.roleRoutes, reviewer: settings.roleRoutes?.composer };
  settings.roleEfforts = { ...settings.roleEfforts, composer: "low", reviewer: "low" };
  const assets = await db.call("composer_asset_library");
  const results = [];
  for (const type of ["photo", "drawing"]) {
    const asset = assets.find((a: { type: string; title: string }) => a.type === type && (type === "photo" || a.title === "Pipeline project coordination illustration"));
    if (!asset) throw new Error(`Missing ${type} fixture`);
    const attempts: unknown[] = [];
    try {
      const result = await reviewedComposition(settings, {
        title: "Engineering plan review — synthetic media test", sourceUrl: "test-fixture",
        paragraphs: [{ id: "P1", section: "Plan review", text: "Project team members examine a shared site plan to discuss proposed work and existing utilities. This synthetic fixture tests an editorial image of that activity; it does not document any named company's project or prescribe work procedures." }],
        existingFigures: [], manualPlacementIds: ["P1"], availableAssets: [asset],
      }, { feedback: `Reuse library asset ${asset.id}. Do not draw an SVG. Caption the scene as an editorial example of reviewing a plan, not a real named project. ${type === "drawing" ? "Disclose that it is AI-generated." : "This photo comes from the user's source document; do not invent identities, location or license."}`, onAttempt: async (attempt: unknown) => { attempts.push(attempt); } });
      results.push({ type, asset, accepted: true, composition: result.composition, attempts });
    } catch (error) { results.push({ type, asset, accepted: false, error: String(error), attempts }); }
    console.log(JSON.stringify({ type, accepted: results.at(-1)?.accepted }));
  }
  await mkdir("artifacts/composer-live", { recursive: true });
  await writeFile("artifacts/composer-live/media-fixture-tests.json", JSON.stringify(results, null, 2));
} finally { await runtime.close(); }
