// SIZES FROM WIKIDATA FOR EXISTING CARDS: adds employees, revenue, assets, budget and population to
// every stakeholder whose web profile is a sure match (lib/knowledge/wikidataSizes.ts). New and
// refreshed lookups do this themselves. Run: node --env-file-if-exists=.env.local scripts/wikidata-sizes.mjs
import { createServer } from "vite";
import { resolve } from "node:path";

const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { addWikidataSizes } = await runtime.ssrLoadModule("/lib/knowledge/wikidataSizes.ts");
  const result = await addWikidataSizes(getAdminSupabase());
  console.log(`Checked ${result.checked} stakeholders with a web profile; added Wikidata sizes to ${result.updated}.`);
} finally {
  await runtime.close();
}
