"use server";
import {z} from "zod";
import {requireUser} from "@/lib/auth/requireUser";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {supabaseRpc} from "@/lib/db/rpc";
import {commitPersonEdit} from "@/lib/change-control";
import {toActionResult} from "./result";
import {manualDomainPlan} from "@/lib/domains/manualEdit";
import type {DecisionSnapshot} from "@/lib/domains/decider";
export async function editGraphDomain(path:string,mode:"rename"|"move"|"remove",value:string){
 return toActionResult(async()=>{
  await requireUser();path=z.string().trim().min(1).max(2000).parse(path);mode=z.enum(["rename","move","remove"]).parse(mode);value=z.string().trim().max(2000).parse(value);
  const db=supabaseRpc(getAdminSupabase());
  const snapshot=await db.call<DecisionSnapshot>("domain_review_snapshot");
  const domain=snapshot.domains.find(d=>d.path===path&&!d.retired_at);
  if(!domain)throw new Error("Domain no longer exists. Reopen the menu.");
  const reason=`${mode==='rename'?'Rename':mode==='move'?'Move':'Remove'} domain ${path}`;
  if(mode==='rename'){
   z.string().min(1).max(100).refine(n=>!n.includes('/')&&n!=='.'&&n!=='..','Use a single domain name.').parse(value);
   const result=await commitPersonEdit(db,reason,[{type:"update_domain",targetId:domain.id,expectedRevisionId:null,passageIds:[],speechAct:null,input:{name:value}}]);
   if(result.status!=="applied")throw new Error("Rename was not applied. Check Changes for details.");
   return {changeSetId:result.changeSetId};
  }
  const operations=manualDomainPlan(snapshot,path,mode,value);
  // Reuse the transactional structural writer and its snapshot undo, attributed to the person.
  const input={name:domain.name,domainReview:true,domainDecider:true,operation:"restructure",confident:true,reason,snapshot,operations};
  const result=await commitPersonEdit(db,reason,[{type:"update_domain",targetId:null,expectedRevisionId:null,passageIds:[],speechAct:null,input}]);
  if(result.status!=="applied")throw new Error("Domain change was not applied. Check Changes for details.");
  return {changeSetId:result.changeSetId};
 });
}
