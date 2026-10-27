// Real search, model calls and downloaded images; database and uploads stay local.
import { createServer } from "vite";
import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { ComposerArticle } from "../lib/composer/compose";
import type { ComposerAttempt } from "../lib/composer/review";
import type { AdminSupabase } from "../lib/supabase/admin";
import type { TokenFactorySettings } from "../lib/ai/chat";
import type { WebImage } from "../lib/composer/webImages";

process.env.PROCESSING_SHARED_LIMITS = "false";
const directory = resolve("artifacts/composer-taste", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(join(directory, "assets"), { recursive: true });
console.log(JSON.stringify({ directory, mode: "isolated database and local uploads; no live writes" }));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": process.cwd(), "server-only": resolve("test/server-only.ts") } } });
const pg = new PGlite();
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
try {
  await pg.exec("create table assets(id uuid primary key, data jsonb not null)");
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  // Only this settings read touches the live database. No memory DB or live logger.
  const choice = await readModelChoice(supabaseRpc(getAdminSupabase()));
  const settings: TokenFactorySettings = tokenFactoryFromEnv(process.env, { ...choice, db: undefined });
  if (!settings) throw new Error("AI settings unavailable");
  delete settings.memoryDb;
  settings.roleEfforts = { ...settings.roleEfforts, composer: "low", reviewer: "low", media_analyst: "low" };
  if (settings.roleRoutes?.composer) settings.roleRoutes = { ...settings.roleRoutes, reviewer: settings.roleRoutes.composer };
  settings.logCall = async (call) => { console.log(JSON.stringify({ call: call.purpose, model: call.model, status: call.status })); };
  const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "extracts|info|revisions", explaintext: "1", inprop: "url", rvprop: "ids", titles: "Deserted medieval village" });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { "User-Agent": "CorpusWiki/0.1 (isolated illustration evaluation)" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
  const source = (await response.json()).query.pages[0];
  let section = "Overview";
  const paragraphs: ComposerArticle["paragraphs"] = [];
  for (const raw of source.extract.split("\n")) {
    const text = raw.trim();
    const heading = /^=+\s*(.*?)\s*=+$/.exec(text);
    if (heading) { section = heading[1]!; if (["See also", "References", "Further reading", "External links"].includes(section)) break; continue; }
    if (text) paragraphs.push({ id: `P${paragraphs.length + 1}`, section, text });
  }
  const article: ComposerArticle = { title: source.title, sourceUrl: source.fullurl, paragraphs, availableAssets: [], existingFigures: [], webImageSearchAvailable: true, imageGenerationAvailable: false, newFigureBudget: 3 };
  await writeFile(join(directory, "source.json"), JSON.stringify({ source, article, note: "Fresh illustration exercise: source article's existing pictures excluded. Original text preserved. Text: Wikipedia contributors, CC BY-SA 4.0." }, null, 2));
  // Adapter implements the production upload/insert calls against local storage/PGlite.
  const sandboxClient = {
    storage: { from: (bucket: string) => ({
      async upload(path: string, bytes: Buffer) { if (bucket !== "composer-images" || !/^[\w-]+\.(jpg|png|webp)$/.test(path)) throw new Error("Unexpected upload target"); await writeFile(join(directory, "assets", path), bytes); return { error: null }; },
      async remove(paths: string[]) { for (const path of paths) await unlink(join(directory, "assets", path)); return { error: null }; },
    }) },
    from: (table: string) => ({ async insert(row: { id: string }) { if (table !== "assets") throw new Error("Unexpected table"); await pg.query("insert into assets values($1,$2::jsonb)", [row.id, JSON.stringify(row)]); return { error: null }; } }),
  } as unknown as AdminSupabase;
  const { composerVisualTaste } = await runtime.ssrLoadModule("/lib/composer/visualTaste.ts");
  const { composerWebImages, saveWebImage } = await runtime.ssrLoadModule("/lib/composer/importImages.ts");
  const { reviewedComposition } = await runtime.ssrLoadModule("/lib/composer/review.ts");
  const audits: unknown[] = []; let auditIndex = 0;
  const visuals = composerVisualTaste(settings, { audit: async (name: string, data: unknown, preview?: Buffer) => {
    const stem = `${String(++auditIndex).padStart(2, "0")}-${name}`;
    audits.push({ name, data }); await writeFile(join(directory, `${stem}.json`), JSON.stringify(data, null, 2));
    if (preview) await writeFile(join(directory, `${stem}.png`), preview);
    console.log(JSON.stringify({ visualAudit: stem, data }));
  } });
  const web = composerWebImages(async () => {}, undefined, async (image: WebImage) => {
    const asset = await saveWebImage(image, await visuals.file(image), sandboxClient);
    visuals.registerAsset(asset.id, image); return asset;
  }, visuals.assess);
  const attempts: ComposerAttempt[] = [];
  const result = await reviewedComposition(settings, article, { inspectComposition: visuals.review, toolsForArticle: (selected: ComposerArticle) => web.tools(selected).map((tool: { name: string; run: (input: unknown) => Promise<unknown> }) => ({ ...tool, run: async (input: unknown) => {
      console.log(JSON.stringify({ tool: tool.name, input }));
      return tool.run(input);
    } })),
    onAttempt: async (attempt: ComposerAttempt) => { attempts.push(attempt); await writeFile(join(directory, "attempts.json"), JSON.stringify(attempts, null, 2)); console.log(JSON.stringify({ attempt: attempts.length, accepted: attempt.accepted, metadataTotal: attempt.total, visual: attempt.visual })); } });
  const rows = (await pg.query<{ data: { id: string; storage_path: string; attribution: string; license: string; deleted_at: string | null } }>("select data from assets")).rows;
  const assets = rows.map((r) => r.data);
  for (const asset of assets.filter((a) => result.composition.figures.some((f: { assetId?: string }) => f.assetId === a.id))) {
    asset.deleted_at = null; await pg.query("update assets set data=$2::jsonb where id=$1", [asset.id, JSON.stringify(asset)]);
  }
  let lastSection = "";
  const body = paragraphs.map((p) => {
    const heading = lastSection !== p.section ? `<h2>${escape(p.section ?? "Overview")}</h2>` : ""; lastSection = p.section ?? "";
    const figure = result.composition.figures.find((f: { after: string }) => f.after === p.id);
    const asset = assets.find((a) => a.id === figure?.assetId);
    const image = asset ? `assets/${asset.storage_path.split("/").at(-1)}` : figure?.svg ? `data:image/svg+xml;base64,${Buffer.from(figure.svg).toString("base64")}` : null;
    return `${heading}<div class="paragraph">${image ? `<figure><img src="${escape(image)}" alt="${escape(figure.alt)}"><figcaption>${escape(figure.caption)}${asset ? `<details><summary>Image source and credits</summary>${escape(asset.attribution)}<br>${escape(asset.license)}</details>` : ""}</figcaption></figure>` : ""}<p>${escape(p.text)}</p></div>`;
  }).join("\n");
  await writeFile(join(directory, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Illustrator sandbox — ${escape(article.title)}</title><style>body{margin:0;background:#f5f5f3;color:#202a34;font:17px/1.65 Georgia,serif}main{max-width:960px;margin:40px auto;padding:32px;background:white}h1{font-size:36px;line-height:1.2}h2{clear:both;border-bottom:1px solid #ddd;font-size:23px;padding-top:22px}.paragraph{display:flow-root}figure{float:right;clear:right;width:256px;margin:0 0 16px 24px;border:1px solid #d9d9d9;padding:4px}img{width:100%;height:auto;display:block}figcaption{font:12px/1.4 Arial,sans-serif;padding:6px 2px}details{margin-top:8px;overflow-wrap:anywhere}summary,a{color:#315b94}p{margin:0 0 18px}.notice,footer{font:13px/1.5 Arial,sans-serif;color:#666}@media(max-width:600px){main{margin:0;padding:18px}figure{float:none;margin:12px 0;width:min(256px,90%)}h1{font-size:28px}}</style><main><div class="notice">ISOLATED TEST • No live article or asset changes • Original Wikipedia images excluded for this fresh-selection exercise</div><h1>${escape(article.title)}</h1>${body}<footer>Article text: <a href="${escape(article.sourceUrl)}">Wikipedia contributors</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Revision ${source.revisions?.[0]?.revid ?? "unknown"}. Images retain their individual credits.</footer></main></html>`);
  await writeFile(join(directory, "result.json"), JSON.stringify({ result, assets, attempts: attempts.length, audits, liveWrites: 0 }, null, 2));
  for (const asset of assets) if (!(await readFile(join(directory, "assets", asset.storage_path.split("/").at(-1)!))).length) throw new Error("Empty upload");
  console.log(JSON.stringify({ complete: true, directory, accepted: result.attempt?.accepted, figures: result.composition.figures.length, uploads: assets.length, attempts: attempts.length, liveWrites: 0 }));
} catch (error) {
  await writeFile(join(directory, "error.txt"), String(error)); throw error;
} finally { await pg.close(); await runtime.close(); }
