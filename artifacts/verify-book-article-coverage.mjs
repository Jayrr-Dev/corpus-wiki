import {createServer} from 'vite';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try {
 const context=JSON.parse(await readFile('artifacts/current-filing-context.json','utf8'));
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
 const {loadArticleClaims}=await runtime.ssrLoadModule('/lib/living-page/articleOrchestrator.ts');
 await withSpaceActor({personId:null,spaceId:'21132c80-32b3-4ef2-9156-d9af60486173',via:'script'},async()=>{
  const started=performance.now();
  const result=await loadArticleClaims(getAdminSupabase(),context.claims.map(c=>c.unitId));
  console.log(JSON.stringify({requested:context.claims.length,loaded:result.claims.length,emptyText:result.claims.filter(c=>!c.content.trim()).length,entities:result.entities.length,durationMs:Math.round(performance.now()-started)}));
  if(result.claims.length!==context.claims.length||result.claims.some(c=>!c.content.trim()))throw Error('Book evidence coverage failed.');
 });
}finally{await runtime.close();}
