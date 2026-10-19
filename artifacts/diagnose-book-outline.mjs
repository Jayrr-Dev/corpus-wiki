import {createServer} from 'vite';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const eventId='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const index=Number(process.argv[2]??3);
if(!Number.isInteger(index)||index<0||index>68)throw Error('Invalid proposal index');
const sql=await targetFromEnvironment(process.env);
const [event]=await sql.query(`select person_id,space_id from shift_events where id='${eventId}'`);
const [saved]=await sql.query(`select output from upload_steps where event_id='${eventId}' and key='article-proposals:${eventId}' and state='succeeded'`);
const item=saved.output.planned[index];
let rejectedPlan;
if(process.argv.includes('--last-rejected')){
 const [audit]=await sql.query(`select proposal->'outlineReview'->'attempts' attempts from article_reviews where event_id='${eventId}' and proposal->>'title'=${quoteLiteral(item.title)} and proposal ? 'outlineReview' order by created_at desc limit 1`);
 if(!audit)throw Error('No rejected outline for this proposal');
 rejectedPlan=audit.attempts.at(-1).plan;
}
await sql.close();
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try{
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor({personId:event.person_id,spaceId:event.space_id,via:'script'},async()=>{
  const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const {tokenFactoryFromEnv}=await runtime.ssrLoadModule('/lib/ai/chat.ts');
  const {readModelChoice}=await runtime.ssrLoadModule('/lib/ai/models.ts');
  const {planArticle}=await runtime.ssrLoadModule('/lib/living-page/articlePlanner.ts');
  const {gradeOutline,reviewPasses,reviewTotal}=await runtime.ssrLoadModule('/lib/living-page/outlineBuilder.ts');
  const db=supabaseRpc(getAdminSupabase());
  const settings=tokenFactoryFromEnv(process.env,await readModelChoice(db));
  if(process.argv.includes('--strong')){
   const {listClaudeModels}=await runtime.ssrLoadModule('/lib/ai/anthropic.ts');
   const models=await listClaudeModels(process.env.ANTHROPIC_API_KEY);
   const stronger=models.find(model=>model.id.includes('sonnet'));
   if(!stronger)throw Error('No Sonnet model offered');
   settings.model=`anthropic/${stronger.id}`;settings.roleRoutes={};
   console.log('Diagnostic model',stronger.id);
  }
  const entity=item.type==='entity'&&item.entity?item.entity:{id:'',type:'',key:'',name:item.title};
  const attempts=[];
  const record=()=>writeFile(`artifacts/book-outline-${index}.json`,JSON.stringify({title:item.title,scope:item.scope,claims:item.claims,attempts},null,2));
  console.log('Diagnosing outline',index,item.title,item.claims.length);
  if(rejectedPlan){
   const result=await gradeOutline(settings,{entity,units:item.claims},rejectedPlan,`${item.title}. Scope: ${item.scope}`);
   console.log('Re-evaluated unchanged outline',JSON.stringify({accepted:reviewPasses(result.value),score:reviewTotal(result.value),review:result.value}));return;
  }
  if(process.argv.includes('--seed')){
   if(index!==3)throw Error('The diagnostic seed only covers proposal 3.');
   const plan={title:item.title,introduction:['C6','C7'],sections:[
    {title:'The Feeling Center and Feeling Triad',claims:['C10','C4','C11']},
    {title:'Triad and type-group membership',claims:['C3','C1']},
    {title:'Background practices and development of the centers',claims:['C2','C5','C8','C9','C12']}
   ]};
   const result=await gradeOutline(settings,{entity,units:item.claims},plan,`${item.title}. Scope: ${item.scope}`);
   console.log('Seed review',JSON.stringify(result.value));return;
  }
  try{const result=await planArticle(settings,{entity,units:item.claims},`${item.title}. Scope: ${item.scope}`,undefined,{onAttempt:a=>{attempts.push(a);console.log(JSON.stringify({accepted:a.accepted,problems:a.problems,review:a.review}));}});console.log('Accepted',result.plan.title);}
  catch(error){console.log(error.message);}
  await record();
 });
}finally{await runtime.close();}
