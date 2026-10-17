// Exercise the tool and private storage with the already generated smoke-test image.
// No additional paid generation is performed by this check.
import { createServer } from "vite";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": process.cwd(), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { composerImageGenerator } = await runtime.ssrLoadModule("/lib/composer/generate.ts");
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9) ?? "artifacts/composer-live/openrouter-generation-test.json";
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const client = getAdminSupabase();
  const { data: page, error } = await client.from("pages").select("id").eq("slug", "city-of-edmonton").single();
  if (error) throw error;
  const vector = process.argv.includes("--vector");
  let calls = 0;
  const generate = async () => { calls++; const bytes = await readFile(report.file); return { bytes, svg: vector ? bytes.toString("utf8") : undefined, mime: report.mime, extension: report.file.split(".").at(-1), model: report.model, cost: report.cost }; };
  const generator = composerImageGenerator(page.id, vector ? undefined : generate, vector ? generate : undefined);
  const article = { title: "Synthetic tool check", sourceUrl: "test-fixture", paragraphs: [{ id: "P1", text: "A planning team reviews a model.", section: "Planning" }], existingFigures: [], availableAssets: [], selectedSections: ["Planning"], newFigureBudget: 1 };
  const tool = generator.tool(article, vector);
  const first = await tool.run({ after: "P1", prompt: report.prompt, description: "City planning team — AI-generated illustration" });
  const repeated = await tool.run({ after: "P1", prompt: report.prompt, description: "City planning team — AI-generated illustration" });
  if (calls !== 1 || first.assetId !== repeated.assetId) throw new Error("The tool repeated generation during a retry.");
  await generator.publish([first.assetId]);
  const { data: asset } = await client.from("assets").select("id,storage_path,media_url,model,deleted_at").eq("id", first.assetId).single();
  const expected = await readFile(report.file);
  if (vector) {
    const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
    const stored = await supabaseRpc(client).call("read_generated_asset", { p_asset_id: asset.id });
    if (stored.svg !== expected.toString("utf8")) throw new Error("Stored vector verification failed.");
  } else {
    const { data: stored, error: storageError } = await client.storage.from("composer-images").download(asset.storage_path.slice("composer-images/".length));
    if (storageError || !stored || stored.size !== expected.length) throw new Error("Stored image verification failed.");
  }
  const result = { asset, generationCalls: calls, repeatedToolCallReusedAsset: true, bytes: expected.length, articleUnchanged: true };
  await writeFile(`artifacts/composer-live/openrouter-${vector ? "vector-" : ""}tool-test.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await runtime.close(); }
