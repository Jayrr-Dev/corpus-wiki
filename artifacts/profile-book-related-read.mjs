import {createServer} from 'vite';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
const eventId='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const [actor]=await db.query(`select person_id,space_id from shift_events where id='${eventId}'`);
const [saved]=await db.query(`select output from upload_steps where event_id='${eventId}' and key='article-proposals:${eventId}'`);
const item=saved.output.planned[7];
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try{
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 const {embedderFromEnv}=await runtime.ssrLoadModule('/lib/ai/embeddings.ts');
 const embedder=embedderFromEnv(process.env);
 const [vector]=await embedder.embed([`${item.title}\n${item.scope}\n${item.claims.map(claim=>claim.content).join('\n')}`.slice(0,6000)]);
 console.log('Query dimensions',vector.length,'subject',item.title);
 if(process.argv.includes('--plan')||process.argv.includes('--compare')||process.argv.includes('--trial')){
  const scope=`select set_config('request.jwt.claims','{"role":"service_role"}',true);select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);set local role space_runtime;`;
  const distance=`(e.embedding operator(extensions.<=>) ${quoteLiteral(JSON.stringify(vector))}::extensions.vector)`;
  if(process.argv.includes('--trial')){
   const migration=await readFile('supabase/migrations/20261118204000_parse_search_vector_once.sql','utf8');
   const start=performance.now();
   const rows=await db.query(`begin;set local statement_timeout='12s';${migration}${scope}select count(*)::int matches from public.similar_units(${quoteLiteral(JSON.stringify(vector))},${quoteLiteral(embedder.model)},16,0.6);rollback;`);
   console.log('Trial with rollback',JSON.stringify({elapsedMs:Math.round(performance.now()-start),rows}));
  } else {
  for(const byUnit of [false,true]){
   const query=byUnit
    ? `with ranked as materialized(select u.id unit_id,e.revision_id,${distance} distance from public.unit_embeddings e join public.units u on u.current_revision_id=e.revision_id and u.retired_at is null where e.model=${quoteLiteral(embedder.model)} and 1-${distance}>=0.6 order by ${distance} limit 16) select ranked.unit_id,r.id,r.content,1-ranked.distance similarity from ranked join public.revisions r on r.id=ranked.revision_id order by ranked.distance`
    : `select u.id,r.id,r.content,1-${distance} similarity from public.unit_embeddings e join public.units u on u.current_revision_id=e.revision_id and u.retired_at is null join public.revisions r on r.id=e.revision_id where e.model=${quoteLiteral(embedder.model)} and 1-${distance}>=0.6 order by ${distance} limit 16`;
   if(process.argv.includes('--compare')){
    if(byUnit)continue;
    const migration=await readFile('supabase/migrations/20261118203000_bounded_related_knowledge.sql','utf8');
    const result=await db.query(`begin;set local statement_timeout='25s';${migration}${scope}
     with original(unit_id,revision_id,content,similarity) as materialized(${query}),changed as materialized(select * from public.similar_units(${quoteLiteral(JSON.stringify(vector))},${quoteLiteral(embedder.model)},16,0.6))
     select (select count(*)::int from original) original_count,(select count(*)::int from changed) bounded_count,
      (select count(*)::int from((select * from original except select * from changed)union all(select * from changed except select * from original)) differences) differences;rollback;`);
    console.log('Rollback equivalence',JSON.stringify(result));continue;
   }
   const started=performance.now();
   let rows;
   try{rows=await db.query(`begin;set local statement_timeout='12s';set local jit=off;${scope} explain(${process.argv.includes('--analyze')?'analyze, buffers, ':''}format json) ${query};rollback;`);}
   catch(error){console.log(JSON.stringify({byUnit,elapsedMs:Math.round(performance.now()-started),error:error.message}));continue;}
   const plan=rows.find(row=>row['QUERY PLAN'])?.['QUERY PLAN'];
   const flatten=(node,depth=0)=>[{depth,node:node['Node Type'],join:node['Join Type'],table:node['Relation Name'],index:node['Index Name'],rows:node['Plan Rows'],cost:node['Total Cost']},...(node.Plans??[]).flatMap(child=>flatten(child,depth+1))];
   console.log(JSON.stringify({byUnit,elapsedMs:Math.round(performance.now()-started),executionMs:plan?.[0]?.['Execution Time'],plan:plan?.flatMap(item=>flatten(item.Plan))}));
  }
  }
 } else {
 for(const jit of (process.argv.includes('--rpc')?[]:['off','on','off','on'])){
  const start=performance.now();
  try{
   await db.query(`begin;set local statement_timeout='12s';set local jit=${jit};select set_config('request.jwt.claims','{"role":"service_role"}',true);select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);set local role space_runtime;select coalesce(json_agg(pgrst_source),'[]') from public.similar_units(${quoteLiteral(JSON.stringify(vector))},${quoteLiteral(embedder.model)},16,0.6) pgrst_source;rollback;`);
   console.log(JSON.stringify({path:'database',jit,ok:true,elapsedMs:Math.round(performance.now()-start)}));
  }catch(error){console.log(JSON.stringify({path:'database',jit,ok:false,elapsedMs:Math.round(performance.now()-start),error:error.message}));}
 }
 await withSpaceActor({personId:actor.person_id,spaceId:actor.space_id,via:'script'},async()=>{
  const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  for(let attempt=0;attempt<(process.argv.includes('--rpc')?3:1);attempt++){
   const start=performance.now();
   const result=await getAdminSupabase().rpc('similar_units',{p_embedding:JSON.stringify(vector),p_model:embedder.model,p_limit:16,p_min:0.6});
   console.log(JSON.stringify({path:'rpc',ok:!result.error,elapsedMs:Math.round(performance.now()-start),rows:result.data?.length,error:result.error?.message}));
  }
 });
 }
}finally{await db.close();await runtime.close();}
