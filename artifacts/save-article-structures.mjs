import { createServer } from 'vite';
import { resolve } from 'node:path';
const runtime = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('.'), 'server-only': resolve('test/server-only.ts') } } });
try {
  const { withSpaceActor } = await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
  const { getAdminSupabase } = await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const { supabaseRpc } = await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const { readPages } = await runtime.ssrLoadModule('/lib/queries/batched.ts');
  const { readArticleStructure, saveArticleStructure, finishArticleStructure } = await runtime.ssrLoadModule('/lib/living-page/articleStructureMemory.ts');
  await withSpaceActor({ personId: null, spaceId: '21132c80-32b3-4ef2-9156-d9af60486173', via: 'script' }, async () => {
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const pages = await readPages((from, to) => client.from('pages').select('id,title').is('retired_at', null).order('id').range(from, to));
    for (const page of pages) {
      const memory = await readArticleStructure(db, page.id);
      if (memory.planned?.plan_key === 'existing-article-baseline:v1' && !memory.applied) {
        await finishArticleStructure(db, memory.planned.id, 'applied');
        console.log(JSON.stringify({ article: page.title, result: 'Baseline synchronized' })); continue;
      }
      if (memory.applied || memory.planned) { console.log(JSON.stringify({ article: page.title, result: 'Existing plan retained' })); continue; }
      const id = await saveArticleStructure(db, { pageId: page.id, key: 'existing-article-baseline:v1', structure: memory.current, changes: { baseline: true },
        rationale: 'Synchronized from the current article as a starting point. This outline is advisory and may be revised when the article or knowledge changes.', model: null });
      await finishArticleStructure(db, id, 'applied');
      const saved = await readArticleStructure(db, page.id);
      console.log(JSON.stringify({ article: page.title, sections: saved.current.length, saved: !!saved.applied, synchronized: saved.applied?.outOfDate === false }));
    }
  });
} finally { await runtime.close(); }
