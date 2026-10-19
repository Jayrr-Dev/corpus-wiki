import {createServer} from 'vite';
import {resolve,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const root=resolve('.');
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null},resolve:{alias:{'@':root,'server-only':join(root,'test/server-only.ts')}}});
try {
 const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
 const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
 const db=supabaseRpc(getAdminSupabase());
 const {readModelChoice}=await runtime.ssrLoadModule('/lib/ai/models.ts');
 const {tokenFactoryFromEnv}=await runtime.ssrLoadModule('/lib/ai/chat.ts');
 const {loadRoleInstructions}=await runtime.ssrLoadModule('/lib/ai/skills/server.ts');
 const {reviewedComposition}=await runtime.ssrLoadModule('/lib/composer/review.ts');
 const {persistentComposerCache}=await runtime.ssrLoadModule('/lib/composer/cache.ts');
 const stats={hits:0,misses:0,writes:0}; const storage=persistentComposerCache(db);
 const cache={get:async key=>{const value=await storage.get(key);stats[value==null?'misses':'hits']++;return value;},set:async(...args)=>{stats.writes++;await storage.set(...args);}};
 const {composerVisualTaste}=await runtime.ssrLoadModule('/lib/composer/visualTaste.ts');
 const {composerWebImages,saveWebImage}=await runtime.ssrLoadModule('/lib/composer/importImages.ts');
 const {composerImageGenerator}=await runtime.ssrLoadModule('/lib/composer/generate.ts');
 const {loadComposerImage}=await runtime.ssrLoadModule('/lib/composer/loadImage.ts');
 const {runComposerClaim}=await runtime.ssrLoadModule('/lib/composer/jobs.ts');
 const pageId='4ec35e88-e49a-4576-b43e-90425bf388e3';
 const baseline=JSON.parse(await readFile('artifacts/composer-live/2026-10-17T16-48-38-717Z-health-safety/before.json','utf8'));
 const current=await db.call('read_composer_run',{p_page_id:pageId});
 const claim=await db.call('claim_composer_job',{p_page_id:pageId,p_automatic:false});
 if(!claim)throw Error('Article busy');
 const calls=[];const attempts=[];const startedAt=new Date().toISOString();
 await runComposerClaim(db,claim,async guard=>{
  if(JSON.stringify(claim.snapshot)!==JSON.stringify(baseline.snapshot))throw Error('Baseline text changed');
  const settings=tokenFactoryFromEnv(process.env,await readModelChoice(db),async call=>{calls.push(call);await db.call('log_ai_call',{p_call:call});});
  settings.roleInstructions=await loadRoleInstructions(db);
  if(!settings.roleRoutes?.reviewer&&settings.roleRoutes?.composer)settings.roleRoutes={...settings.roleRoutes,reviewer:settings.roleRoutes.composer};
  settings.roleEfforts={...settings.roleEfforts,composer:settings.roleEfforts?.composer??'low',reviewer:settings.roleEfforts?.reviewer??'low'};
  const library=await db.call('composer_asset_library');
  // Replay the original task: only assets that existed before the baseline run.
  const rows=await getAdminSupabase().from('assets').select('id').lt('created_at','2026-10-17T16:48:38Z');
  if(rows.error)throw rows.error;const oldIds=new Set(rows.data.map(r=>r.id));
  const target=claim.snapshot.paragraphs.filter(p=>p.section==='Noise exposure program').map(p=>p.id);
  const retained=current.composition.figures.filter(f=>!target.includes(f.after));
  const article={...claim.snapshot,sourceUrl:'/p/health-safety',availableAssets:library.filter(a=>oldIds.has(a.id)),existingFigures:retained.map(f=>({after:f.after,learningGoal:f.learningGoal})),manualPlacementIds:target,newFigureBudget:1,webImageSearchAvailable:true,imageGenerationAvailable:Boolean(process.env.OPENROUTER_API_KEY)};
  const visuals=composerVisualTaste(settings,{cache,guard,loadAsset:loadComposerImage});
  const web=composerWebImages(guard,undefined,async image=>{const a=await saveWebImage(image,await visuals.file(image));visuals.registerAsset(a.id,image);return a;},visuals.assess,cache);
  const generator=composerImageGenerator(pageId,undefined,undefined,guard);
  const result=await reviewedComposition(settings,article,{feedback:await readFile('artifacts/composer-live-feedback.txt','utf8'),inspectComposition:visuals.review,prepareComposition:generator.prepare,toolsForArticle:a=>[...web.tools(a),...(article.imageGenerationAvailable?[generator.tool(a),generator.tool(a,true)]:[])],onAttempt:async a=>{attempts.push(a);console.log(JSON.stringify({accepted:a.accepted,visual:a.visual,total:a.total}));}});
  if(!result.attempt)throw Error(result.composition.omitted);
  const composition={...result.composition,figures:[...retained,...result.composition.figures]};
  const published=[...web.created,...generator.created].filter(id=>composition.figures.some(f=>f.assetId===id));
  await guard();await generator.publish(published);
  try{await db.call('save_composer_run_checked',{p_page_id:pageId,p_snapshot:claim.snapshot,p_composition:composition,p_review:{...result.attempt.review,visual:result.attempt.visual,selection:result.selection},p_model:result.attempt.model,p_expected_run_id:current.id});}catch(e){await generator.hide(published);throw e;}
  await writeFile(`artifacts/composer-live/cache-benchmark-${process.argv[2]??'run'}.json`,JSON.stringify({startedAt,stats,calls,attempts,result,published},null,2));
  console.log(JSON.stringify({published,stats,calls:calls.map(c=>({purpose:c.purpose,input:c.promptTokens,output:c.completionTokens,cost:(c.promptTokens*4+c.completionTokens*20)/1e6}))}));
 });
}finally{await runtime.close();}
