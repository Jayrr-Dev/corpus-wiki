import { createServer } from 'vite';
import { resolve } from 'node:path';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
const parentId = '1e422980-2866-4193-9e58-50d565d66159';
const db = await targetFromEnvironment(process.env);
let actor;
try { [actor] = await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'"); }
finally { await db.close(); }
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
 const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor({ personId: actor.person_id, spaceId: actor.space_id, via: 'script' }, async () => {
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const { loadScaffoldUnits } = await runtime.ssrLoadModule('/lib/living-page/articleScaffold.ts');
  const client = getAdminSupabase();
  const planned = await loadScaffoldUnits(client, [parentId]);
  const state = await supabaseRpc(client).call('read_section_state', { p_section_id: 'e27de4cc-0ec3-44fb-b194-03bde9ee604b' });
  const expected = state.units.filter(unit => unit.unitId === parentId || unit.memberOf === parentId);
  const actualIds = planned.map(unit => unit.unitId).sort();
  const expectedIds = expected.map(unit => unit.unitId).sort();
  const members = planned.filter(unit => unit.memberOf === parentId);
  const same = JSON.stringify(actualIds) === JSON.stringify(expectedIds);
  console.log(JSON.stringify({ selectedParentCount: 1, planningUnits: planned.length, liveWriterUnitsForParent: expected.length, sameEvidenceSet: same,
   parentStructure: planned.find(unit => unit.unitId === parentId)?.structure, memberPositions: members.map(unit => unit.position).sort(),
   includesPreviouslyUnplannedLevelSix: members.some(unit => unit.unitId === '191cfee1-69ed-476a-9f9d-f2fe99592e26') }));
  if (!same || planned.length !== 6 || members.length !== 5 || !members.some(unit => unit.unitId === '191cfee1-69ed-476a-9f9d-f2fe99592e26')) throw Error('Live scaffold membership verification failed');
 });
} finally { await runtime.close(); }
