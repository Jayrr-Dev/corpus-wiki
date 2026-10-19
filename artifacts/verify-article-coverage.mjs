import { createServer } from 'vite';
import { resolve } from 'node:path';
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
  const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const { readModelChoice } = await runtime.ssrLoadModule('/lib/ai/models.ts');
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule('/lib/ai/chat.ts');
  const { loadStageSkills } = await runtime.ssrLoadModule('/lib/ai/skills/server.ts');
  const { TokenFactorySectionWriter } = await runtime.ssrLoadModule('/lib/living-page/writers/tokenFactory.ts');
  const { runPageReview } = await runtime.ssrLoadModule('/lib/living-page/runPageReview.ts');
  await withSpaceActor({ personId: null, spaceId: '21132c80-32b3-4ef2-9156-d9af60486173', via: 'script' }, async () => {
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), call => db.call('log_ai_call', { p_call: call }));
    if (!settings) throw new Error('No configured writer');
    settings.skills = await loadStageSkills(db);
    const writer = new TokenFactorySectionWriter(settings);
    writer.progress = sectionId => ({ step: detail => console.log(sectionId, detail), thinking: () => {}, draft: () => {}, done: () => {} });
    console.log(await runPageReview(db, settings, 'bcfad1d9-f25d-47db-bb63-da4af4d8bafe', null, console.log, 'Use the saved evidence fully. Add substantive topic sections where warranted; keep each relevant detail and its qualifications.', { client, writer }));
  });
} finally { await runtime.close(); }
