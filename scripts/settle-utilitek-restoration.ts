import { createServer } from "vite";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { SectionState } from "../lib/living-page/types";

// Reverting an outline marks restored sections stale. Settle them only after
// verifying unchanged evidence and exact restored/tested text through the normal
// fenced build lifecycle. No new prose or facts are generated here.
const original = JSON.parse(await readFile(resolve("artifacts/utilitek-editorial-test/2026-10-17T16-20-39-643Z/original.json"), "utf8")) as { states: SectionState[] };
const tested = JSON.parse(await readFile(resolve("artifacts/utilitek-editorial-test/2026-10-17T16-20-39-643Z/result.json"), "utf8")) as { states: SectionState[] };
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { rebuildSection } = await runtime.ssrLoadModule("/lib/living-page/index.ts");
  const db = supabaseRpc(getAdminSupabase());
  for (const before of original.states) {
    const expected = tested.states.find((state) => state.sectionId === before.sectionId)!;
    const verify = (state: SectionState) => {
      assert.deepEqual(state.units, before.units, `Evidence changed for ${before.title}`);
      assert.deepEqual(state.lines.map((line) => [line.content, line.author, [...line.unitIds].sort()]), expected.lines.map((line) => [line.content, line.author, [...line.unitIds].sort()]), `Text changed for ${before.title}`);
    };
    const current = await db.call("read_section_state", { p_section_id: before.sectionId });
    verify(current);
    await db.call("resume_section_build", { p_section_id: before.sectionId });
    const finished = await rebuildSection(db, {
      name: "verified-restoration", prepareSection: async (state: SectionState) => { verify(state); return state; },
      reviseSection: async () => ({ modelVersion: "verified-restoration", revise: [], retire: [], add: [] }),
    }, before.sectionId, null, false);
    assert(finished, "A concurrent section build prevented verification");
    console.log(`Verified restored section: ${before.title}`);
  }
} finally { await runtime.close(); }
