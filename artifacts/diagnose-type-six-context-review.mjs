import {createServer} from 'vite';import {resolve} from 'node:path';import {writeFile} from 'node:fs/promises';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
process.env.COMPOSER_AUTO_ENABLED='false';
const eventId='811105ea-fcfe-4ac4-9c7d-dc589b1501e4',pageId='0cf0833e-9894-42ea-a9bf-62a36eeb1c9b';
const sql=await targetFromEnvironment(process.env);
const [event]=await sql.query(`select person_id,space_id from shift_events where id='${eventId}'`);
const [draft]=await sql.query(`select output from upload_steps where event_id='${eventId}' and key='outline-v1:758ad45c7c8d0f7254f5674ac05416ffa3e034b433c9589034382a3508821547:5:draft' and state='succeeded'`);
const [discovery]=await sql.query(`select output from upload_steps where event_id='${eventId}' and key='article-coverage:${pageId}:discover-v2:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' and state='succeeded'`);
await sql.close();if(!draft||!discovery)throw Error('Saved planning evidence is missing');
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try{
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor({personId:event.person_id,spaceId:event.space_id,via:'script'},async()=>{
  const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');const client=getAdminSupabase();
  const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');const db=supabaseRpc(client);
  const {readModelChoice}=await runtime.ssrLoadModule('/lib/ai/models.ts');const {tokenFactoryFromEnv}=await runtime.ssrLoadModule('/lib/ai/chat.ts');
  const {parseKnowledgeContext}=await runtime.ssrLoadModule('/lib/knowledge/context.ts');const {readIdBatches,readPages}=await runtime.ssrLoadModule('/lib/queries/batched.ts');
  const {gradeOutline,structuralProblems,reviewPasses,reviewTotal}=await runtime.ssrLoadModule('/lib/living-page/outlineBuilder.ts');
  const settings=tokenFactoryFromEnv(process.env,await readModelChoice(db));if(!settings)throw Error('No configured AI');
  const {data:page,error:pe}=await client.from('pages').select('title,scope').eq('id',pageId).single();if(pe)throw Error(pe.message);
  const {data:rows,error}=await client.from('sections').select('id,mode,position').eq('page_id',pageId).is('retired_at',null).order('position');if(error)throw Error(error.message);
  const selected=[];
  for(const row of rows){const state=await db.call('read_section_state',{p_section_id:row.id});const protectedSection=row.mode!=='generated'||state.lines.some(l=>l.author==='person')||(!state.units.length&&state.lines.some(l=>l.content.trim()))||await db.call('composer_section_has_images',{p_section_id:row.id});if(!protectedSection)selected.push(...state.units);}
  const ids=discovery.output.sections.flatMap(s=>s.query.unitIds??[]);
  const extras=await readIdBatches(ids,batch=>readPages((from,to)=>client.from('units').select('id,current_revision_id,kind,epistemic_status').in('id',batch).is('retired_at',null).order('id').range(from,to)));
  const revisions=await readIdBatches(extras.map(u=>u.current_revision_id),batch=>readPages((from,to)=>client.from('revisions').select('id,content,knowledge_context').in('id',batch).order('id').range(from,to)));const byId=new Map(revisions.map(r=>[r.id,r]));
  const units=[...new Map([...selected,...extras.map(u=>({unitId:u.id,revisionId:u.current_revision_id,kind:u.kind,epistemicStatus:u.epistemic_status,content:byId.get(u.current_revision_id)?.content??'',context:parseKnowledgeContext(byId.get(u.current_revision_id)?.knowledge_context)}))].map(u=>[u.unitId,u])).values()];
  if(!/Six/i.test(units[34]?.content??'')||!/Nine/i.test(units[34]?.content??'')||!/Four/i.test(units[59]?.content??'')||!/depress/i.test(units[59]?.content??''))throw Error('Saved C refs no longer match the reconstructed evidence');
  const knowledge={entity:{id:'',type:'topic',key:'',name:page.title},units};const plan=draft.output.value.plan;const problems=structuralProblems(plan,knowledge);if(problems.length)throw Error(problems.join(';'));
  console.log(JSON.stringify({diagnostic:'unchanged saved outline',title:page.title,claims:units.length,structuralProblems:problems}));
  const result=await gradeOutline(settings,knowledge,plan,`${page.title}. Scope: ${page.scope??''}`);
  const report={pageId,knowledge,plan,review:result.value,accepted:reviewPasses(result.value),score:reviewTotal(result.value)};await writeFile('artifacts/type-six-context-review-diagnostic.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({accepted:report.accepted,score:report.score,review:report.review}));
 });
}finally{await runtime.close();}
