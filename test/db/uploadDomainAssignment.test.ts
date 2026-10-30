import { createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { recordUpload } from "@/lib/ingest/pipeline";
import { submitChangeSet, commitChangeSet } from "@/lib/change-control";
import { topicPlacerFor } from "@/lib/ingest/placeTopicsServer";
import { placementActions } from "@/lib/ai/tokenFactory/placeTopics";
import { chatJson } from "@/lib/ai/chat";
import type { ReconciliationInput } from "@/lib/ai/types";
import type { UploadTopicContext } from "@/lib/domains/uploadAssignment";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc } from "@/lib/db/rpc";

vi.mock("@/lib/ai/chat",async original=>({...await original<typeof import("@/lib/ai/chat")>(),chatJson:vi.fn()}));
// The shared (cached) block and the batch's block, read as one request payload
const payloadOf=(request:{messages:{role:string;content:unknown}[]})=>Object.assign({},...request.messages.filter(m=>m.role==="user"&&typeof m.content==="string"&&m.content.startsWith("{")).map(m=>JSON.parse(m.content as string)));
let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async()=>{store=await portablePostgres();});
afterAll(async()=>{await store.pg.close();});
beforeEach(async()=>{await store.pg.exec("begin");vi.mocked(chatJson).mockReset();});
afterEach(async()=>{await store.pg.exec("rollback");});

it("packs unfinished small groups without repeating an older accepted review or crossing scopes",async()=>{
 const event=await setup(Array.from({length:84},(_,i)=>`Permit condition ${i+1} applies to the site.`));
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 const context=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 const batches:string[][]=[];
 let seeded=false;
 const db:DbRpc={call:async(fn,args)=>{
  if(!seeded&&args&&fn==="read_completed_upload_step"&&String(args.p_key).includes(":review-v2:")) {
   seeded=true;
   await store.db.call("start_upload_step",args);
   await store.db.call("finish_upload_step",{...args,p_error:null,p_output:{
    placements:[[context.claims[0]!.unitId,["Upload test/Permits"]]],
    rationales:[[context.claims[0]!.unitId,"Previously independently reviewed"]],tokensIn:10,tokensOut:10,model:"test",
   }});
  }
  return store.db.call(fn,args);
 }};
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan") {
   const payload=payloadOf(request);
   value={groups:payload.claims.map((c:{ref:string},i:number)=>({scopePath:i===83?"Upload test/Responsibilities":"Upload test",subject:`Subject ${c.ref}`,reason:`Reason ${c.ref}`,refs:[c.ref]}))};
  } else if(request.name==="place_topics") {
   const payload=payloadOf(request);
   batches.push(payload.claims.map((c:{ref:string})=>c.ref));
   expect(payload.claims.some((c:{ref:string})=>c.ref==="C1")).toBe(false);
   expect(payload.context.sourceEvidence).toHaveLength(payload.claims.length);
   expect(payload.filePlan.groups).toHaveLength(84);
   expect(payload.previousPlacements).toBeUndefined();
   expect(payload.filedDestinations).toEqual([expect.objectContaining({path:"Upload test/Permits"})]);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:[payload.scopePath==="Upload test"?"Upload test/Permits":payload.scopePath]}))};
  } else if(request.name==="independent_upload_domain_review") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   if(payload.proposal[0].ref==="C2")expect(payload.previousDestinationClaims.map((c:{ref:string})=>c.ref)).toEqual(["C1"]);
   value={approved:true,issues:[],parents:payload.parents.map((p:object)=>({...p,reason:"Full evidence supports this destination."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await uploadExecution.run({eventId:event,token:owner.token,db},()=>topicPlacerFor(db,{apiKey:"test"})(event));
 expect(seeded).toBe(true);
 expect(batches.map(b=>b.length)).toEqual([80,2,1]);
 expect(batches.at(-1)).toEqual(["C84"]);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});

it("with TOPIC_PROMPT_BUDGET on, splits a batch whose prompts would pass the token budget and still files every claim",async()=>{
 vi.stubEnv("TOPIC_PROMPT_BUDGET","on");
 try {
  const event=await setup(Array.from({length:40},(_,i)=>`Permit condition ${i+1}: `+"the site crew records each excavation check. ".repeat(180)));
  const batches:number[]=[];
  const reviewSizes:number[]=[];
  const planSizes:number[]=[];
  vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
   const payload=request.messages.filter(m=>m.role==="user"&&(m.content as string).startsWith("{")).map(m=>JSON.parse(m.content as string)).find(block=>block.claims||block.proposal);
   let value:unknown;
   if(request.name==="upload_domain_plan")planSizes.push(request.messages.reduce((n,m)=>n+(m.content as string).length,0));
   if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Permits",reason:"Permit policy",refs:payload.claims.map((c:{ref:string})=>c.ref)}]};
   else if(request.name==="place_topics") {
    batches.push(payload.claims.length);
    value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:["Upload test/Permits"]}))};
   } else if(request.name==="independent_upload_domain_review") {
    reviewSizes.push(request.messages.reduce((n,m)=>n+(m.content as string).length,0));
    const review=JSON.parse(request.messages.at(-1)!.content as string);
    value={approved:true,issues:[],parents:review.parents.map((p:object)=>({...p,reason:"Permit checks belong together."}))};
   } else throw new Error(request.name);
   return {value,model:"test",tokensIn:10,tokensOut:10} as never;
  });
  await topicPlacerFor(store.db,{apiKey:"test"})(event);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.reduce((a,b)=>a+b,0)).toBe(40);
  expect(planSizes.length).toBeGreaterThan(1);
  expect(Math.max(...planSizes,...reviewSizes)/2.4).toBeLessThan(100_000);
  expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 } finally { vi.unstubAllEnvs(); }
});

async function setup(contents=["A permit is required within 1m.","Workers follow design standards.","The employer is responsible for worker safety."]) {
 await store.pg.exec("insert into domains(name,path,proposed_by) values ('Upload test','Upload test','person'); insert into domains(name,path,parent_id,proposed_by) select n.name,'Upload test/'||n.name,d.id,'person' from domains d cross join (values ('Permits'),('Responsibilities')) n(name) where d.path='Upload test';");
 const upload=await recordUpload(store.db,{title:"ULA permit and safety policy.docx",mimeType:"text/plain",sourceDate:"2026-10-16T00:00:00Z",hash:"domain-assignment-test",storagePath:"test/assignments.txt",passages:[{position:0,text:"A permit is required within 1m. Workers follow design standards. The employer is responsible for worker safety.",location:{heading:"Permit rules and responsibilities"},hash:"assignment-passage",speakerLabel:null}]});
 if(upload.kind!=="started")throw new Error("Expected new upload");
 const input=await store.db.call<ReconciliationInput>("reconciliation_input",{p_event_id:upload.eventId});
 const {changeSetId}=await submitChangeSet(store.db,{eventId:upload.eventId,cause:"upload",actor:"ai"},{summary:"Extract policy",trace:{modelVersion:"test",promptVersion:"test",tokensIn:0,tokensOut:0},actions:contents.map(content=>({type:"add_claim",targetId:null,expectedRevisionId:null,passageIds:[input.passages[0]!.id],speechAct:"stated",input:{content,kind:"fact",epistemicStatus:"supported",validFrom:"2026-10-16T00:00:00Z",entities:[],domainPaths:[]}}))});
 expect((await commitChangeSet(store.db,changeSetId)).status).toBe("applied");
 return upload.eventId;
}
function model(options:{omitFirst?:boolean;rejectAll?:boolean;noParents?:boolean;beforeReview?:()=>Promise<void>}={}) {
 let proposals=0;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value: unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Permit policy",reason:"The source's policy scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {proposals++;value={placements:[{ref:"C1",domainPaths:["Upload test/Permits"]},{ref:"C2",domainPaths:["Upload test/Permits"]},...(!options.omitFirst||proposals>1?[{ref:"C3",domainPaths:["Upload test/Responsibilities"]}]:[])]};}
  else if(request.name==="independent_upload_domain_review") {
   await options.beforeReview?.();
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={approved:!options.rejectAll,issues:options.rejectAll?["The group needs correction"]:[],parents:options.noParents?[]:payload.parents.map((p:object)=>({...p,reason:"These claims fit the existing subject domain."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={verdicts:payload.issues.map((issue:{issue:number})=>({issue:issue.issue,blocking:true,reason:"The placement defect remains."}))};
  } else throw new Error("Unexpected model call "+request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 return ()=>proposals;
}
it("supplies real source context, repairs missing assignments, files every unit and restores memberships on undo",async()=>{
 const event=await setup();const proposals=model({omitFirst:true});
 const context=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 expect(context.sourceTitle).toBe("ULA permit and safety policy.docx");
 expect(context.evidence[0]!.passages[0]!.location).toEqual({heading:"Permit rules and responsibilities"});
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(proposals()).toBe(2);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 const writes=await store.pg.query<{id:string}>("select c.id from change_sets c where event_id=$1 and summary like 'Assigned %'",[event]);
 expect(writes.rows).toHaveLength(1);
 const placements=await store.pg.query("select d.path from unit_domains m join domains d on d.id=m.domain_id where m.unit_id=any($1) order by d.path",[context.claims.map(c=>c.unitId)]);
 expect(placements.rows).toEqual([{path:"Upload test/Permits"},{path:"Upload test/Permits"},{path:"Upload test/Responsibilities"}]);
 await store.db.call("revert_change_set",{p_change_set_id:writes.rows[0]!.id});
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toHaveLength(3);
});
it("keeps a filing the review approved without listing its destinations",async()=>{
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 const event=await setup();const proposals=model({noParents:true});
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 expect(proposals()).toBe(1);
 expect(warn.mock.calls.some(([message])=>/did not list every destination/.test(String(message)))).toBe(true);
 warn.mockRestore();
});

it("keeps the last valid filing when independent review rejects every attempt, so the upload goes on",async()=>{
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 const event=await setup();model({rejectAll:true});
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 expect((await store.pg.query("select id from change_sets where event_id=$1 and summary like 'Assigned %'",[event])).rows).toHaveLength(1);
 expect(warn.mock.calls.some(([message])=>/Filing kept/.test(String(message)))).toBe(true);
 warn.mockRestore();
});
it("identifies an invented planning child scope and requires a valid anchor on retry",async()=>{
 const event=await setup();model();
 const original=vi.mocked(chatJson).getMockImplementation()!;
 let attempts=0;
 vi.mocked(chatJson).mockImplementation(async(settings,request)=>{
  if(request.name!=="upload_domain_plan")return original(settings,request);
  attempts++;
  if(attempts>1) {
   const payload=payloadOf(request);
   expect(payload.feedback).toContain('Invalid scopePath: "Upload test/Invented child"');
   expect(payload.feedback).toContain("ONE root name with no slash");
  }
  return {value:{groups:[{scopePath:attempts===1?"Upload test/Invented child":"Upload test",subject:"Permit policy",reason:"Source scope",refs:["C1","C2","C3"]}]},model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(attempts).toBe(2);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});
it("requires a corrected proposal after concrete independent review feedback",async()=>{
 const event=await setup();
 let reviews=0;
 let corrected=false;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {
   const feedback=request.messages.at(-1)?.content;
   corrected=typeof feedback==="string"&&feedback.includes("C3 is an employer responsibility");
   const payload=payloadOf(request);
   expect(payload.claims.map((c:{ref:string})=>c.ref)).toEqual(corrected?["C3"]:["C1","C2","C3"]);
   if(corrected)expect(payload.previousPlacements.map((c:{ref:string})=>c.ref)).toEqual(["C1","C2"]);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:[corrected&&c.ref==="C3"?"Upload test/Responsibilities":"Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   expect(request.messages.some(m=>typeof m.content==="string"&&m.content.includes("Do not require a book-named"))).toBe(true);
   reviews++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   expect(payload.proposal.map((c:{ref:string})=>c.ref)).toEqual(corrected?["C3"]:["C1","C2","C3"]);
   if(corrected)expect(payload.input.previousPlacements.map((c:{ref:string})=>c.ref)).toEqual(["C1","C2"]);
   value={approved:corrected,issues:corrected?[]:["C3 is an employer responsibility and belongs under Responsibilities."],parents:payload.parents.map((p:object)=>({...p,reason:"Claims fit the destination subject."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={verdicts:payload.issues.map((issue:{issue:number})=>({issue:issue.issue,blocking:true,reason:"The placement defect remains."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(reviews).toBe(2);
 expect(corrected).toBe(true);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});
it("retains subject corrections and identifies omitted refs during a corrective retry",async()=>{
 const event=await setup();
 let proposals=0,reviews=0;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {
   proposals++;
   const payload=payloadOf(request);
   const feedback=request.messages.at(-1)!.content as string;
   if(proposals>1)expect(payload.claims.map((c:{ref:string})=>c.ref)).toEqual(["C2","C3"]);
   if(proposals===3) {
    expect(feedback).toContain("C2 and C3 need Responsibilities");
    expect(feedback).toContain("Missing refs: C2");
    expect(feedback).toContain('Required answer refs (exactly once each, no context-only refs): ["C2","C3"]');
   }
   value={placements:payload.claims.filter((c:{ref:string})=>proposals!==2||c.ref!=="C2").map((c:{ref:string})=>({ref:c.ref,domainPaths:[proposals===1?"Upload test/Permits":"Upload test/Responsibilities"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   reviews++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   expect(payload.proposal.map((c:{ref:string})=>c.ref)).toEqual(reviews===1?["C1","C2","C3"]:["C2","C3"]);
   value={approved:reviews===2,issues:reviews===1?["C2 and C3 need Responsibilities"]:[],parents:payload.parents.map((p:object)=>({...p,reason:"The complete corrected proposal fits."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={verdicts:payload.issues.map((issue:{issue:number})=>({issue:issue.issue,blocking:true,reason:"The placement defect remains."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(proposals).toBe(3);expect(reviews).toBe(2);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});
it("repairs all current members of a flagged destination alongside individually named refs",async()=>{
 const event=await setup();let proposals=0,reviews=0;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {
   proposals++;
   const payload=payloadOf(request);
   // The parent-level issue names no refs. C1 and C2 must still be repairable.
   expect(payload.claims.map((c:{ref:string})=>c.ref)).toEqual(["C1","C2","C3"]);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:[proposals>1?"Upload test/Responsibilities":c.ref==="C3"?"Upload test":"Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   reviews++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   const corrected=payload.proposal.every((c:{domainPaths:string[]})=>c.domainPaths[0]==="Upload test/Responsibilities");
   value={approved:corrected,issues:corrected?[]:["Upload test/Permits holds responsibility claims; move its current members to Responsibilities.","C3 also belongs under Responsibilities."],parents:payload.parents.map((p:object)=>({...p,reason:"The corrected group is coherent."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={verdicts:payload.issues.map((issue:{issue:number})=>({issue:issue.issue,blocking:true,reason:"The placement defect remains."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(proposals).toBe(2);expect(reviews).toBe(2);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});
it("omits unused vectors until filed neighbors exist, preserving source evidence and similarity candidates",async()=>{
 const event=await setup();
 await store.pg.exec("delete from unit_domains");
 const before=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 const first=before.claims[0]!.unitId;
 await store.pg.query("insert into unit_embeddings(unit_id,revision_id,model,embedding) select id,current_revision_id,'fixture',array_fill(0.1::real,array[1024])::extensions.vector from units where id=any($1)",[before.claims.map(c=>c.unitId)]);
 const empty=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 expect(empty.vectors).toEqual([]);
 expect(empty.claims).toEqual(before.claims);
 expect(empty.evidence).toEqual(before.evidence);
 await store.pg.query("insert into unit_domains(unit_id,domain_id) select $1,id from domains where path='Upload test'",[first]);
 const filed=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 expect(filed.vectors).toHaveLength(3);
 expect(filed.claims).toHaveLength(2);
 expect(filed.vectors.map(v=>v.revisionId).sort()).toEqual(before.revisions.filter(r=>before.claims.some(c=>c.unitId===r.unitId)).map(r=>r.revisionId).sort());
});
it("commits assignments through the upload's fenced, replayable workflow writes",async()=>{
 const event=await setup();model();
 const claim=await store.db.call<{claimed:boolean;token:string}>("claim_upload_workflow",{p_event_id:event,p_continue:false});
 expect(claim.claimed).toBe(true);
 await uploadExecution.run({eventId:event,token:claim.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 const writes=(await store.pg.query<{function_name:string}>("select function_name from upload_writes where event_id=$1",[event])).rows;
 expect(writes.map(w=>w.function_name).sort()).toEqual(["commit_upload_topics","submit_change_set"]);
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toEqual([]);
});
it("preserves a manual assignment made while the AI reviews",async()=>{
 const event=await setup();const context=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 model({beforeReview:async()=>{await store.pg.query("insert into unit_domains(unit_id,domain_id) select $1,id from domains where path='Upload test' on conflict do nothing",[context.claims[0]!.unitId]);await store.pg.exec("savepoint manual_assignment");}});
 await expect(topicPlacerFor(store.db,{apiKey:"test"})(event)).rejects.toThrow("assignment changed");
 await store.pg.exec("rollback to savepoint manual_assignment");
 expect((await store.pg.query("select d.path from unit_domains m join domains d on d.id=m.domain_id where m.unit_id=$1",[context.claims[0]!.unitId])).rows).toEqual([{path:"Upload test"}]);
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toHaveLength(2);
});
it("keeps new-root approval in the critical path",async()=>{
 const event=await setup();const context=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 const actions=placementActions(new Map(context.claims.map(c=>[c.unitId,["New approved company/Requirements"]])),context.domainPaths,"New company policy").map(a=>a.type==="place_claim"?{...a,expectedRevisionId:context.revisions.find(r=>r.unitId===a.targetId)!.revisionId,input:{...a.input,uploadAssignment:true}}:a);
 const {changeSetId}=await submitChangeSet(store.db,{eventId:event,cause:"upload",actor:"ai"},{summary:"New company assignments",actions,trace:{modelVersion:"test",promptVersion:"test",tokensIn:0,tokensOut:0}});
 await store.db.call("commit_upload_topics",{p_event_id:event,p_change_set_id:changeSetId});
 expect(await store.db.call("upload_workflow_waiting",{p_event_id:event})).toBe(true);
 const exception=(await store.pg.query<{id:string}>("select e.id from exceptions e join actions a on a.id=e.action_id where a.change_set_id=$1 and e.reason='root_domain_approval'",[changeSetId])).rows[0]!;
 await store.pg.query("insert into unit_domains(unit_id,domain_id) select $1,id from domains where path='Upload test'",[context.claims[0]!.unitId]);
 await store.pg.exec("savepoint held_root");
 await expect(store.db.call("resolve_exception",{p_exception_id:exception.id,p_accept:true,p_note:null})).rejects.toThrow("assignment changed");
 await store.pg.exec("rollback to savepoint held_root");
 expect((await store.pg.query("select path from domains where path='New approved company'")).rows).toHaveLength(0);
 expect((await store.pg.query("select d.path from unit_domains m join domains d on d.id=m.domain_id where m.unit_id=$1",[context.claims[0]!.unitId])).rows).toEqual([{path:"Upload test"}]);
});
it("keeps whole-file context and stable references across an 81-unit group",async()=>{
 const event=await setup(Array.from({length:81},(_,i)=>`Permit rule ${i+1} applies to construction work.`));
 const batchRefs:string[][]=[];
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan") {
   const payload=payloadOf(request);
   value={groups:[{scopePath:"Upload test",subject:"Permit rules",reason:"Permit conditions",refs:payload.claims.map((c:{ref:string})=>c.ref)}]};
  } else if(request.name==="place_topics") {
   const payload=payloadOf(request);
   expect(payload.filePlan.groups).toEqual([{scopePath:"Upload test",subject:"Permit rules",reason:"Permit conditions",claims:81}]);
   batchRefs.push(payload.claims.map((c:{ref:string})=>c.ref));
   if(batchRefs.length===2)expect(payload.filedDestinations).toEqual([expect.objectContaining({path:"Upload test/Permits",claims:80})]);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:["Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={approved:true,issues:[],parents:payload.parents.map((p:object)=>({...p,reason:"Permit requirements belong here."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(batchRefs.map(r=>r.length)).toEqual([80,1]);
 expect(batchRefs[1]).toEqual(["C81"]);
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toEqual([]);
});
it("checkpoints bounded planning steps and resumes without repeating a completed plan",async()=>{
 const event=await setup(Array.from({length:161},(_,i)=>`Permit condition ${i+1} applies to the site.`));
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 const planned:number[]=[];
 let fail=true;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan") {
   const payload=payloadOf(request);
   planned.push(payload.claims.length);
   expect(payload.overview).toHaveLength(161);
   expect(payload.claims.every((c:{content:string})=>c.content.includes("Permit condition"))).toBe(true);
   if(payload.claims.length===1&&fail){fail=false;throw new Error("Planning connection interrupted");}
   value={groups:[{scopePath:"Upload test",subject:"Permit conditions",reason:"Permit conditions in the source",refs:payload.claims.map((c:{ref:string})=>c.ref)}]};
  } else if(request.name==="place_topics") {
   const payload=payloadOf(request);
   expect(payload.filePlan.groups.reduce((n:number,g:{claims:number})=>n+g.claims,0)).toBe(161);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:["Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={approved:true,issues:[],parents:payload.parents.map((p:object)=>({...p,reason:"Permit conditions are coherent."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 const run=()=>uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 await expect(run()).rejects.toThrow("Planning connection interrupted");
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toHaveLength(161);
 await run();
 expect(planned).toEqual([160,1,1]);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});
it("resumes independently reviewed batches with full current and cumulative destination evidence",async()=>{
 const event=await setup(Array.from({length:81},(_,i)=>`Permit condition ${i+1} applies to the site.`));
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 const placements:number[]=[];
 const reviews:number[]=[];
 let fail=true;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan") {
   const payload=payloadOf(request);
   value={groups:[{scopePath:"Upload test",subject:"Permits",reason:"Permit conditions",refs:payload.claims.map((c:{ref:string})=>c.ref)}]};
  } else if(request.name==="place_topics") {
   const payload=payloadOf(request);
   placements.push(payload.claims.length);
   expect(payload.claims.every((c:{content:string})=>c.content.includes("Permit condition"))).toBe(true);
   expect(payload.context.sourceEvidence).toHaveLength(payload.claims.length);
   expect(payload.filePlan.groups.every((g:object)=>!Object.hasOwn(g,"refs"))).toBe(true);
   if(payload.claims.length===1&&fail){fail=false;throw new Error("Placement connection interrupted");}
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:["Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   reviews.push(payload.proposal.length);
   expect(typeof payload.input).toBe("object");
   if(payload.proposal.length===1) {
    expect(payload.parents[0].refs).toEqual(["C81"]);
    expect(payload.previousDestinationClaims).toHaveLength(6);
    expect(payload.input.filedDestinations).toEqual([expect.objectContaining({path:"Upload test/Permits",claims:80})]);
    expect(payload.previousDestinationClaims.every((c:{content:string})=>c.content.includes("Permit condition"))).toBe(true);
   }
   value={approved:true,issues:[],parents:payload.parents.map((p:object)=>({...p,reason:"Permit conditions fit this destination."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 const run=()=>uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 await expect(run()).rejects.toThrow("Placement connection interrupted");
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toHaveLength(81);
 await run();
 expect(placements).toEqual([80,1,1]);
 expect(reviews).toEqual([80,1]);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});

it("resumes saved review corrections after interruption without regenerating rejected proposals",async()=>{
 const event=await setup();
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 let proposals=0,reviews=0,interrupt=true;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {
   proposals++;
   const payload=payloadOf(request);
   if(proposals>1) {
    expect(payload.claims.map((c:{ref:string})=>c.ref)).toEqual(["C3"]);
    expect(request.messages.at(-1)!.content).toContain("C3 belongs under Responsibilities");
    expect(request.messages.at(-1)!.content).toContain('"ref":"C1"');
    if(interrupt){interrupt=false;throw new Error("Provider connection interrupted");}
   }
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:[proposals>1?"Upload test/Responsibilities":"Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   reviews++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   if(reviews>1)expect(payload.priorReviewIssues).toEqual([["C3 belongs under Responsibilities"]]);
   value={approved:reviews>1,issues:reviews===1?["C3 belongs under Responsibilities"]:[],parents:payload.parents.map((p:object)=>({...p,reason:"Claims belong together."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={verdicts:payload.issues.map((issue:{issue:number})=>({issue:issue.issue,blocking:true,reason:"The placement defect remains."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 const run=()=>uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 await expect(run()).rejects.toThrow("Provider connection interrupted");
 expect((await store.db.call<{unplaced:string[]}>("verify_upload_topic_coverage",{p_event_id:event})).unplaced).toHaveLength(3);
 await run();
 expect(proposals).toBe(3);expect(reviews).toBe(2);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});

it("stops asking after three matching reviews of a proposal that no longer changes",async()=>{
 const event=await setup();
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 let proposals=0,reviews=0;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {
   proposals++;
   const payload=payloadOf(request);
   if(proposals>1)expect(payload.claims.map((c:{ref:string})=>c.ref)).toEqual(["C3"]);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:[c.ref==="C3"?"Upload test/Responsibilities":"Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   reviews++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   expect(payload.priorReviewIssues).toHaveLength(reviews-1);
   value={approved:false,issues:["C3 needs a supported responsibility assignment"],parents:payload.parents.map((p:object)=>({...p,reason:"Subject coherence assessed."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={verdicts:payload.issues.map((issue:{issue:number})=>({issue:issue.issue,blocking:true,reason:"The placement defect remains."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 await uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 warn.mockRestore();
 expect(proposals).toBe(3);expect(reviews).toBe(3);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 expect((await store.pg.query("select count(*)::int n from unit_domains m join actions a on a.target_id=m.unit_id join change_sets c on c.id=a.change_set_id where c.event_id=$1 and a.type='add_claim'",[event])).rows).toEqual([{n:3}]);
});

it("finishes corrected filing when a fresh evidence check dismisses a repeated optional objection",async()=>{
 const event=await setup();let proposals=0,reviews=0,confirmations=0;
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {
   proposals++;
   const payload=payloadOf(request);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:[proposals>1&&c.ref==="C3"?"Upload test/Responsibilities":"Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   reviews++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={approved:false,issues:reviews===1?["C3 belongs under Responsibilities"]:["C3 could also stay in the broad parent rather than Responsibilities."],parents:payload.parents.map((p:object)=>({...p,reason:"These claims form a coherent subject group."}))};
  } else if(request.name==="independent_upload_domain_issue_check") {
   confirmations++;
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   if(confirmations===1){value={verdicts:[{issue:1,blocking:true,reason:"C3 states an employer responsibility."}]};return {value,model:"test",tokensIn:10,tokensOut:10} as never;}
   expect(payload.evidence.claims.find((c:{ref:string})=>c.ref==="C3").domainPaths).toEqual(["Upload test/Responsibilities"]);
   expect(payload.evidence.priorReviewIssues).toEqual([["C3 belongs under Responsibilities"]]);
   value={verdicts:[{issue:1,blocking:false,reason:"Responsibilities accurately names the employer responsibility; the parent is an optional alternative."}]};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(proposals).toBe(2);expect(reviews).toBe(2);expect(confirmations).toBe(2);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});

it("atomically files a book-sized upload without dropping claims beyond API row limits",async()=>{
 const event=await setup(Array.from({length:1843},(_,index)=>`Permit condition ${index+1} governs work near utilities.`));
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan") {
   const payload=payloadOf(request);
   value={groups:[{scopePath:"Upload test",subject:"Permit conditions",reason:"Source-backed permit policy",refs:payload.claims.map((c:{ref:string})=>c.ref)}]};
  } else if(request.name==="place_topics") {
   const payload=payloadOf(request);
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:["Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   value={approved:true,issues:[],parents:payload.parents.map((p:object)=>({...p,reason:"All supplied permit conditions belong to this policy subject."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 const saved=await store.pg.query<{count:number}>("select count(*)::int as count from actions a join change_sets c on c.id=a.change_set_id where c.event_id=$1 and a.type='place_claim' and a.outcome='applied'",[event]);
 expect(saved.rows[0]!.count).toBe(1843);
},60000);

it("asks again only for destinations a review approved without assessing, without re-placing the batch",async()=>{
 const event=await setup();let proposals=0;const reviews:{parents:{path:string}[];request?:string}[]=[];
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  if(request.name==="upload_domain_plan")value={groups:[{scopePath:"Upload test",subject:"Policy",reason:"Source scope",refs:["C1","C2","C3"]}]};
  else if(request.name==="place_topics") {proposals++;value={placements:[{ref:"C1",domainPaths:["Upload test/Permits"]},{ref:"C2",domainPaths:["Upload test/Permits"]},{ref:"C3",domainPaths:["Upload test/Responsibilities"]}]};}
  else if(request.name==="independent_upload_domain_review") {
   const payload=JSON.parse(request.messages.at(-1)!.content as string);
   reviews.push(payload);
   const parents=payload.parents.map((p:{path:string;refs:string[]})=>({...p,reason:"Coherent."}));
   value={approved:true,issues:[],parents:reviews.length===1?parents.filter((p:{path:string})=>p.path==="Upload test/Permits"):parents};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 await topicPlacerFor(store.db,{apiKey:"test"})(event);
 expect(proposals).toBe(1);
 expect(reviews.map(r=>r.parents.map(p=>p.path).sort())).toEqual([["Upload test/Permits","Upload test/Responsibilities"],["Upload test/Responsibilities"]]);
 expect(reviews[1]!.request).toContain("did not assess");
 expect((reviews[1] as unknown as {proposal:{ref:string}[]}).proposal.map(c=>c.ref)).toEqual(["C3"]);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});

it("keeps finished plan steps and reviewed batches when the upload context changes before a resume",async()=>{
 const event=await setup(Array.from({length:81},(_,i)=>`Permit condition ${i+1} applies to the site.`));
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 let plans=0,fail=true;const placements:number[]=[];
 vi.mocked(chatJson).mockImplementation(async(_settings,request)=>{
  let value:unknown;
  const payload=payloadOf(request);
  if(request.name==="upload_domain_plan") {plans++;value={groups:[{scopePath:"Upload test",subject:"Permits",reason:"Permit conditions",refs:payload.claims.map((c:{ref:string})=>c.ref)}]};}
  else if(request.name==="place_topics") {
   placements.push(payload.claims.length);
   if(payload.claims.length===1&&fail){fail=false;throw new Error("Placement connection interrupted");}
   value={placements:payload.claims.map((c:{ref:string})=>({ref:c.ref,domainPaths:["Upload test/Permits"]}))};
  } else if(request.name==="independent_upload_domain_review") {
   const review=JSON.parse(request.messages.at(-1)!.content as string);
   value={approved:true,issues:[],parents:review.parents.map((p:object)=>({...p,reason:"Permit conditions fit."}))};
  } else throw new Error(request.name);
  return {value,model:"test",tokensIn:10,tokensOut:10} as never;
 });
 const run=()=>uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 await expect(run()).rejects.toThrow("Placement connection interrupted");
 // Another upload adds a domain meanwhile: the old whole-context keys would all miss now
 await store.pg.exec("insert into domains(name,path,proposed_by) values ('Elsewhere','Elsewhere','person')");
 await run();
 expect(plans).toBe(1);
 expect(placements).toEqual([80,1,1]);
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
});

it("reuses a plan step saved under the place-v4 key of an upload already in flight",async()=>{
 const event=await setup();model();
 const owner=await store.db.call<{token:string}>("claim_upload_workflow",{p_event_id:event});
 const context=await store.db.call<UploadTopicContext>("upload_topic_context",{p_event_id:event});
 const key=`place-v4:${createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0,24)}:plan:0`;
 const args={p_event_id:event,p_token:owner.token,p_key:key};
 await store.db.call("start_upload_step",args);
 await store.db.call("finish_upload_step",{...args,p_error:null,p_output:{groups:[{scopePath:"Upload test",subject:"Saved plan",reason:"Planned before the update",refs:["C1","C2","C3"]}],tokensIn:5,tokensOut:5,model:"test"}});
 const original=vi.mocked(chatJson).getMockImplementation()!;
 vi.mocked(chatJson).mockImplementation(async(settings,request)=>{
  if(request.name==="upload_domain_plan")throw new Error("The saved plan should be reused");
  return original(settings,request);
 });
 await uploadExecution.run({eventId:event,token:owner.token,db:store.db},()=>topicPlacerFor(store.db,{apiKey:"test"})(event));
 expect(await store.db.call("verify_upload_topic_coverage",{p_event_id:event})).toEqual({unplaced:[]});
 expect((await store.pg.query("select count(*)::int n from upload_steps where event_id=$1 and key like 'place-v5:plan:0:%' and state='succeeded'",[event])).rows).toEqual([{n:1}]);
});
