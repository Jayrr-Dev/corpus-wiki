import { createServer } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
const sourceId = '4d1ebe80-779e-4c7f-9e30-80a47c8af886';
const db = await targetFromEnvironment(process.env);
let actor;
try { [actor] = await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'"); }
finally { await db.close(); }
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
 const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor({ personId: actor.person_id, spaceId: actor.space_id, via: 'script' }, async () => {
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { fetchGraphRows } = await runtime.ssrLoadModule('/lib/graph/rows.ts');
  const { buildGraph } = await runtime.ssrLoadModule('/lib/graph/build.ts');
  const { DEFAULT_GRAPH_SETTINGS, withDomainColorGroups } = await runtime.ssrLoadModule('/lib/graph/settings.ts');
  const { groupColorLookup, groupCounts } = await runtime.ssrLoadModule('/lib/graph/groups.ts');
  const rows = await fetchGraphRows(getAdminSupabase());
  const graph = buildGraph(rows);
  const sourceUnits = new Set(rows.sourceUnits.filter(row => row.source_id === sourceId).map(row => row.unit_id));
  const nodes = graph.nodes.filter(node => node.kind === 'unit' && sourceUnits.has(node.id));
  const settings = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, graph.nodes);
  const lookup = groupColorLookup(settings.groups);
  const counts = new Map();
  for (const node of nodes) { const color = lookup(node); counts.set(color ?? 'uncolored', (counts.get(color ?? 'uncolored') ?? 0) + 1); }
  const groupMatches = groupCounts(settings.groups, nodes);
  const legacy = settings.groups.filter(group => /brightwater|epcor|utilitek/i.test(group.query));
  const report = { spaceId: actor.space_id, sourceNodes: nodes.length, uncoloredSourceNodes: counts.get('uncolored') ?? 0,
   activeColorGroups: [...groupMatches.values()].filter(count => count > 0).length, distinctColors: counts.size,
   legacyWorkspaceGroups: legacy.length, colors: Object.fromEntries(counts),
   groups: settings.groups.map(group => ({ query: group.query, color: group.color, sourceNodes: groupMatches.get(group.id) ?? 0 })) };
  await writeFile('artifacts/source-graph-color-verification-root.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, groups: undefined }));
  if (nodes.length < 1843 || report.uncoloredSourceNodes || report.legacyWorkspaceGroups) throw Error('Source graph color integrity is not proven');
 });
} finally { await runtime.close(); }
