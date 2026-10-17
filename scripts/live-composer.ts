import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AdminSupabase } from "../lib/supabase/admin";
import type { DbRpc } from "../lib/db/rpc";
import type { ComposerAttempt } from "../lib/composer/review";
import type { ComposerSnapshot, ComposerRun } from "../lib/composer/types";
import type { RoleInstruction } from "../lib/ai/skills/types";

const arg = (name: string) => process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const slug = arg("slug");
if (!slug) throw new Error("Specify --slug=the-exact-article-slug.");
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const client = getAdminSupabase() as AdminSupabase;
  const db = supabaseRpc(client) as DbRpc;
  const { data: page, error } = await client.from("pages").select("id,title,slug").eq("slug", slug).is("retired_at", null).single();
  if (error) throw new Error(error.message);
  const directory = resolve("artifacts/composer-live", `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}`);
  await mkdir(directory, { recursive: true });
  const before = await db.call<ComposerSnapshot>("composer_page_snapshot", { p_page_id: page.id });
  const previous = await db.call<ComposerRun | null>("read_composer_run", { p_page_id: page.id });
  await writeFile(join(directory, "before.json"), JSON.stringify({ page, snapshot: before, previous }, null, 2));
  if (process.argv.includes("--configure")) {
    const roles = await db.call<RoleInstruction[]>("get_ai_role_instructions");
    const { COMPOSER_INSTRUCTIONS } = await runtime.ssrLoadModule("/lib/ai/composerPolicy.ts");
    await writeFile(join(directory, "previous-role.json"), JSON.stringify(roles.find((r) => r.role === "composer") ?? null, null, 2));
    await db.call("save_ai_role_instructions", { p_role: "composer", p_instructions: COMPOSER_INSTRUCTIONS, p_expected_version: roles.find((r) => r.role === "composer")?.version ?? null });
    if (arg("model")) await db.call("set_ai_role_model", { p_role: "composer", p_model: arg("model") });
  }
  if (process.argv.includes("--inspect")) {
    console.log(JSON.stringify({ directory, page, paragraphs: before.paragraphs.length, sourceFigures: before.paragraphs.filter((p) => p.hasMedia).length, composerFigures: previous?.composition.figures.length ?? 0 }));
  } else {
    const { composeLivePage } = await runtime.ssrLoadModule("/lib/composer/live.ts");
    const attempts: ComposerAttempt[] = [];
    try {
      const result = await composeLivePage(db, page.id, { model: arg("model"), feedback: arg("feedback-file") ? await readFile(resolve(arg("feedback-file")!), "utf8") : undefined,
        targetParagraphIds: arg("section") ? before.paragraphs.filter((p) => p.section === arg("section")).map((p) => p.id) : undefined,
        onAttempt: async (attempt: ComposerAttempt) => {
          attempts.push(attempt);
          await writeFile(join(directory, "attempts.json"), JSON.stringify(attempts, null, 2));
          console.log(JSON.stringify({ article: page.title, attempt: attempts.length, total: attempt.total, accepted: attempt.accepted, figures: attempt.composition.figures.length, problems: [...attempt.validation, ...attempt.review.problems] }));
        },
      });
      const after = await db.call<ComposerSnapshot>("composer_page_snapshot", { p_page_id: page.id });
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("The article changed during the run; inspect before reviewing its illustrations.");
      const run = await db.call<ComposerRun | null>("read_composer_run", { p_page_id: page.id });
      await writeFile(join(directory, "after.json"), JSON.stringify({ page, result, run, textUnchanged: true }, null, 2));
      console.log(JSON.stringify({ directory, page, ...result, textUnchanged: true }));
    } catch (error) { await writeFile(join(directory, "error.txt"), error instanceof Error ? error.stack ?? error.message : String(error)); throw error; }
  }
} finally { await runtime.close(); }
