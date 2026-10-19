import { createServer } from 'vite';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
process.env.COMPOSER_AUTO_ENABLED = 'false';
const eventId = '811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const prefix = 'outline-v1:b471dd74ecb72caaca2749f7c99a4174ba6ed68cde9dc06cac664a42e4d43e29';
const saved = JSON.parse(await readFile('artifacts/type-six-context-review-diagnostic.json', 'utf8'));
const sql = await targetFromEnvironment(process.env);
let event, rows, page;
try {
  [event] = await sql.query(`select person_id,space_id from shift_events where id='${eventId}'`);
  rows = await sql.query(`select key,output from upload_steps where event_id='${eventId}' and key like '${prefix}:%' and state='succeeded' order by key`);
  [page] = await sql.query(`select title,scope from pages where id='${saved.pageId}'`);
} finally { await sql.close(); }
const draft = rows.find(row => row.key === `${prefix}:5:draft`)?.output?.value?.plan;
const prior = rows.filter(row => /:[0-4]:review-v2$/.test(row.key)).map(row => row.output.value);
if (!draft || prior.length !== 5 || saved.knowledge.units.length !== 103) throw Error('Diagnostic inputs incomplete');
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
  const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
  await withSpaceActor({ personId: event.person_id, spaceId: event.space_id, via: 'script' }, async () => {
    const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
    const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
    const db = supabaseRpc(getAdminSupabase());
    const { readModelChoice } = await runtime.ssrLoadModule('/lib/ai/models.ts');
    const { tokenFactoryFromEnv } = await runtime.ssrLoadModule('/lib/ai/chat.ts');
    const { gradeOutline, structuralProblems, reviewPasses, reviewTotal } = await runtime.ssrLoadModule('/lib/living-page/outlineBuilder.ts');
    const problems = structuralProblems(draft, saved.knowledge);
    if (problems.length) throw Error(problems.join('; '));
    const choice = await readModelChoice(db);
    const reviewerModel = process.argv.find(value => value.startsWith('--reviewer-model='))?.split('=')[1];
    const settings = tokenFactoryFromEnv(process.env, reviewerModel ? { ...choice, roleModels: { ...choice.roleModels, reviewer: reviewerModel } } : choice);
    if (!settings) throw Error('No configured AI');
    console.log(JSON.stringify({ diagnostic: 'unchanged final rejected outline with prior review findings', claims: 103, priorReviews: prior.length }));
    const result = await gradeOutline(settings, saved.knowledge, draft, `${page.title}. Scope: ${page.scope ?? ''}`, prior);
    const report = { pageId: saved.pageId, plan: draft, review: result.value, accepted: reviewPasses(result.value), score: reviewTotal(result.value) };
    await writeFile(reviewerModel ? 'artifacts/consistent-outline-review-alternate-model.json' : 'artifacts/consistent-outline-review-diagnostic.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  });
} finally { await runtime.close(); }
