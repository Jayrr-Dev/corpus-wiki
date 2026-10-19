import { createServer } from 'vite';
import { resolve } from 'node:path';
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const { rebuildSection, getSectionWriter } = await runtime.ssrLoadModule('/lib/living-page/index.ts');
  const { readModelChoice } = await runtime.ssrLoadModule('/lib/ai/models.ts');
  const { loadStageSkills } = await runtime.ssrLoadModule('/lib/ai/skills/server.ts');
  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const writer = getSectionWriter(process.env, await readModelChoice(db), await loadStageSkills(db), call => db.call('log_ai_call', { p_call: call }));
  const id = '780726b5-70fb-44c4-8d1b-f7069e42c89a';
  await db.call('resume_section_build', { p_section_id: id });
  console.log('Build result', await rebuildSection(db, writer, id, null));
  console.log('Verified section', await client.from('sections').select('status,build_cancelled').eq('id',id).single());
} finally { await runtime.close(); }
