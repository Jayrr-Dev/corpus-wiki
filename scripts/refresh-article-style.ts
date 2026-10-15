import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

// Explicit maintenance command: rewrites generated article prose, never claims.
// node --experimental-strip-types --env-file=.env.local scripts/refresh-article-style.ts
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root,"test/server-only.ts") } } });
try {
  const { getServerDeps } = await runtime.ssrLoadModule("/lib/server/deps.ts");
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { refreshSectionStyle } = await runtime.ssrLoadModule("/lib/living-page/refreshStyle.ts");
  const { ARTICLE_STYLE_VERSION } = await runtime.ssrLoadModule("/lib/living-page/articleStyle.ts");
  const deps = await getServerDeps();
  if (deps.writer.name !== "token-factory") throw new Error("Configure the AI provider before rewriting articles.");
  const client = getAdminSupabase();
  const snapshot = async () => {
    const [units,sources,pages] = await Promise.all([
      client.from("units").select("id,current_revision_id").order("id"),
      client.from("sources").select("id,hash").order("id"),
      client.from("pages").select("id,title,slug,parent_page_id,context_entity_id,domain_id,retired_at").order("id"),
    ]);
    for (const result of [units,sources,pages]) if (result.error) throw new Error(result.error.message);
    return { units:units.data, sources:sources.data, pages:pages.data };
  };
  const before = await snapshot();
  const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const pageById = new Map(before.pages.filter((page: {retired_at: string|null}) => !page.retired_at).map((page: {id:string;title:string}) => [page.id,page.title]));
  const { data: sections, error } = await client.from("sections").select("id,title,page_id").eq("mode","generated").is("retired_at",null).order("page_id").order("position");
  if (error) throw new Error(error.message);
  const selected = sections.filter((section: {page_id:string}) => pageById.has(section.page_id));
  const progressPath = join(tmpdir(),`second-brain-style-refresh-${Date.now()}.json`);
  const report = { style:ARTICLE_STYLE_VERSION, startedAt:new Date().toISOString(), articles:pageById.size, totalSections:selected.length, completed:[] as string[], failed:[] as {sectionId:string;error:string}[], integrityVerified:false };
  console.log(JSON.stringify({style:report.style,articles:report.articles,sections:report.totalSections,report:progressPath}));
  for (const section of selected) {
    try {
      await refreshSectionStyle(deps.db,deps.writer,section.id);
      report.completed.push(section.id);
      console.log(`${report.completed.length}/${selected.length}: ${pageById.get(section.page_id)} — ${section.title}`);
    } catch (error) {
      const message=error instanceof Error ? error.message : String(error);
      report.failed.push({sectionId:section.id,error:message});
      console.error(`Section failed: ${section.title}: ${message}`);
    }
    await writeFile(progressPath,JSON.stringify(report,null,2));
  }
  report.integrityVerified = fingerprint(before) === fingerprint(await snapshot());
  await writeFile(progressPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if (report.failed.length || !report.integrityVerified) process.exitCode=1;
} finally { await runtime.close(); }
