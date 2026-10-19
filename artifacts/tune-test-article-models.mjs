import { createServer } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
const eventId = '811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const sql = await targetFromEnvironment(process.env);
let actor;
try { [actor] = await sql.query(`select person_id,space_id from shift_events where id='${eventId}'`); }
finally { await sql.close(); }
if (actor.space_id !== '21132c80-32b3-4ef2-9156-d9af60486173') throw Error('Unexpected test workspace');
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
 const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor({ personId: actor.person_id, spaceId: actor.space_id, via: 'script' }, async () => {
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const db = supabaseRpc(getAdminSupabase());
  const { readModelChoice, saveRoleModel } = await runtime.ssrLoadModule('/lib/ai/models.ts');
  const before = await readModelChoice(db);
  if (before.model !== 'anthropic/claude-haiku-5-5' || before.roleModels.plan_articles || before.roleModels.reviewer) throw Error('Model choices changed; inspect before tuning');
  await writeFile('artifacts/book-article-models-before.json', JSON.stringify({ spaceId: actor.space_id, model: before.model, roleModels: before.roleModels, effort: before.effort, roleEfforts: before.roleEfforts }, null, 2), { flag: 'wx' });
  for (const role of ['plan_articles', 'reviewer']) await saveRoleModel(db, role, 'anthropic/claude-sonnet-5-5');
  const after = await readModelChoice(db);
  console.log(JSON.stringify({ spaceId: actor.space_id, model: after.model, roleModels: after.roleModels }));
 });
} finally { await runtime.close(); }
