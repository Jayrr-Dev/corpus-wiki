import {expect,it} from "vitest";
import {portablePostgres} from "./portablePostgres";
import {commitPersonEdit} from "@/lib/change-control";
import {manualDomainPlan} from "@/lib/domains/manualEdit";
import type {DecisionSnapshot} from "@/lib/domains/decider";
it("moves and removes populated domains as undoable person edits, rejecting cycles",async()=>{
 const {pg,db}=await portablePostgres();
 try{
  await pg.exec("insert into domains(name,path,proposed_by) values ('Menu test','Menu test','person'); insert into domains(name,path,parent_id,proposed_by) select 'Group','Menu test/Group',id,'person' from domains where path='Menu test'; insert into domains(name,path,parent_id,proposed_by) select 'Child','Menu test/Group/Child',id,'person' from domains where path='Menu test/Group'; insert into unit_domains(unit_id,domain_id) select '00000000-0000-4000-8000-010000000001',id from domains where path='Menu test/Group';");
  const snapshot=await db.call<DecisionSnapshot>('domain_review_snapshot');
  expect(()=>manualDomainPlan(snapshot,'Menu test/Group','move','Menu test/Group/Child')).toThrow('subtree');
  for(const [path,mode,destination] of [['Menu test/Group/Child','move','Menu test'],['Menu test/Group','remove','']] as const){
   const input={name:'',domainReview:true,domainDecider:true,operation:'restructure',confident:true,reason:'Manual domain change',snapshot,operations:manualDomainPlan(snapshot,path,mode,destination)};
   const result=await commitPersonEdit(db,'Manual domain change',[{type:'update_domain',targetId:null,expectedRevisionId:null,passageIds:[],speechAct:null,input}]);
   expect(result.status).toBe('applied');
   expect((await pg.query("select id from domains where path='Menu test/Child' and retired_at is null")).rows).toHaveLength(1);
   if(mode==='remove')expect((await pg.query("select ud.unit_id from unit_domains ud join domains d on d.id=ud.domain_id where d.path='Menu test'")).rows).toHaveLength(1);
   await db.call('revert_change_set',{p_change_set_id:result.changeSetId});
   expect(await db.call('domain_review_snapshot')).toEqual(snapshot);
  }
 }finally{await pg.close();}
},120000);
