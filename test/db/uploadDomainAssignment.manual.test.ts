import { expect,it } from "vitest";
import { writeFileSync } from "node:fs";
import { targetFromEnvironment } from "@/scripts/db/targets";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc, type DbRpc, type RpcArgs } from "@/lib/db/rpc";
import { readModelChoice } from "@/lib/ai/models";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { topicPlacerFor } from "@/lib/ingest/placeTopicsServer";
import type { UploadTopicContext } from "@/lib/domains/uploadAssignment";
import type { DraftAction } from "@/lib/ai/types";

// Opt-in real-model check. Live data is read only; every write is intercepted.
it.skipIf(process.env.RUN_DOMAIN_ASSIGNMENT_EVAL!=="1")("reviews existing ULA knowledge with real AI without changing live assignments",async()=>{
 const sql=await targetFromEnvironment(process.env);
 try {
  const rows=await sql.query<{event_id:string;context:UploadTopicContext}>(`select e.id as event_id,public.upload_topic_context(e.id) as context
    from shift_events e join sources s on s.id=e.source_id where s.title ilike '%Utility Line Assignment%'
    and exists(select 1 from actions a join change_sets c on c.id=a.change_set_id where c.event_id=e.id and a.type::text='add_claim' and a.outcome='applied')
    order by e.created_at desc limit 1`);
  const selected=rows[0];if(!selected)throw new Error("No ULA upload available for evaluation");
  const context=selected.context;
  const ids=new Set(context.evidence.map(e=>e.unitId));
  const incoming=context.snapshot.claims.filter(c=>ids.has(c.id)&&!c.retiredAt);
  context.claims=incoming.map(c=>({unitId:c.id,title:"",content:c.content,entities:[]}));
  expect(context.claims.length).toBeGreaterThan(3);
  const live=supabaseRpc(getAdminSupabase());
  let actions:DraftAction[]=[];
  const calls:{purpose:string;status:string|null}[]=[];
  const adapter:DbRpc={async call<T>(fn:string,args:RpcArgs={}) {
   if(fn==="upload_topic_context")return context as T;
   if(fn==="submit_change_set"){actions=args.p_actions as DraftAction[];return {changeSetId:"00000000-0000-4000-8000-000000000099",eventId:selected.event_id} as T;}
   if(fn==="commit_upload_topics")return {status:"applied"} as T;
   if(fn==="upload_workflow_waiting")return false as T;
   if(fn==="verify_upload_topic_coverage")return {unplaced:context.claims.filter(c=>!actions.some(a=>a.type==="place_claim"&&a.targetId===c.unitId)).map(c=>c.unitId)} as T;
   if(["get_ai_role_instructions","get_role_memory"].includes(fn))return live.call<T>(fn,args);
   throw new Error("Dry run blocked unexpected database operation: "+fn);
  }};
  const settings=tokenFactoryFromEnv(process.env,await readModelChoice(live),async call=>{calls.push({purpose:call.purpose,status:call.status??null});console.log(call.purpose,call.status,`${Math.round(call.durationMs/1000)}s`);});
  if(!settings)throw new Error("AI provider missing");
  await topicPlacerFor(adapter,settings)(selected.event_id);
  const placed=actions.filter(a=>a.type==="place_claim");
  expect(placed).toHaveLength(context.claims.length);
  const result={source:context.sourceTitle,claims:context.claims.length,calls,createdDomains:actions.filter(a=>a.type==="create_domain").map(a=>a.input.path),
    placements:placed.map(a=>({content:context.claims.find(c=>c.unitId===a.targetId)!.content,domains:a.input.domainPaths,reason:a.input.rationale}))};
  writeFileSync("artifacts/domain-assignment-ULA-evaluation.json",JSON.stringify(result,null,2));
  console.log(JSON.stringify({claims:result.claims,createdDomains:result.createdDomains,calls:result.calls.length,domainCounts:placed.reduce((counts,a)=>{for(const path of a.input.domainPaths)counts[path]=(counts[path]??0)+1;return counts;},{} as Record<string,number>)}));
 }finally{await sql.close();}
},600000);
