import { createServer } from 'vite';
import { resolve } from 'node:path';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
process.env.COMPOSER_AUTO_ENABLED = 'false';
const pageId = '0cf0833e-9894-42ea-a9bf-62a36eeb1c9b';
const sql = await targetFromEnvironment(process.env);
let actor;
try {
 [actor] = await sql.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 const [pending] = await sql.query(`select count(*)::int count from sections where page_id='${pageId}' and retired_at is null and (status<>'current' or nullif(btrim(body),'') is null)`);
 if (pending.count) throw Error('Type Six is still being written; leave its worker running');
} finally { await sql.close(); }
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
 const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor({ personId: actor.person_id, spaceId: actor.space_id, via: 'script' }, async () => {
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const db = supabaseRpc(getAdminSupabase());
  const { readModelChoice } = await runtime.ssrLoadModule('/lib/ai/models.ts');
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule('/lib/ai/chat.ts');
  const logCall = call => db.call('log_ai_call', { p_call: call });
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), logCall);
  if (!settings) throw Error('No configured AI');
  const { embedderFromEnv } = await runtime.ssrLoadModule('/lib/ai/embeddings.ts');
  const { reviewContextWindow } = await runtime.ssrLoadModule('/lib/ai/contextWindow.ts');
  console.log(JSON.stringify({ pageId, contextWindow: await reviewContextWindow(settings) }));
  const { runPageReview } = await runtime.ssrLoadModule('/lib/living-page/runPageReview.ts');
  const result = await runPageReview(db, settings, pageId, embedderFromEnv(process.env, logCall), detail => console.log(detail));
  console.log(JSON.stringify(result));
 });
} finally { await runtime.close(); }
