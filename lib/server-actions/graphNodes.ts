"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { commitPersonEdit } from "@/lib/change-control";
import { toActionResult } from "./result";

export async function moveGraphClaim(unitId: string, sourcePath: string, destinationPath: string) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(unitId);
    const client = getAdminSupabase();
    const [unit, memberships, domains] = await Promise.all([
      client.from("units").select("current_revision_id").eq("id",unitId).is("retired_at",null).single(),
      client.from("unit_domains").select("domain_id").eq("unit_id",unitId),
      client.from("domains").select("id,path").is("retired_at",null),
    ]);
    for (const result of [unit,memberships,domains]) if (result.error) throw new Error(result.error.message);
    const paths = domains.data!.filter(d=>memberships.data!.some(m=>m.domain_id===d.id)).map(d=>d.path);
    if (sourcePath && !paths.includes(sourcePath)) throw new Error("Membership changed. Reopen the menu.");
    if (!domains.data!.some(d=>d.path===destinationPath)) throw new Error("Choose an existing domain.");
    const result = await commitPersonEdit(supabaseRpc(client), "Move graph claim to " + destinationPath, [{type:"place_claim",targetId:unitId,expectedRevisionId:unit.data!.current_revision_id,passageIds:[],speechAct:null,input:{domainPaths:[...new Set([...paths.filter(p=>p!==sourcePath),destinationPath])],rationale:"Moved by the user from the graph."}}]);
    if (result.status!=="applied") throw new Error("Move was not applied. Check Changes for details.");
    return {changeSetId:result.changeSetId};
  });
}

export async function setGraphLinkRemoved(unitId: string, linkId: string, removed: boolean) {
  return toActionResult(async () => {
    await requireUser(); z.uuid().parse(unitId); z.uuid().parse(linkId); z.boolean().parse(removed);
    const client=getAdminSupabase();
    const {data:link,error}=await client.from("relationships").select("*").eq("id",linkId).single();
    if(error) throw new Error(error.message);
    if(link.from_unit_id!==unitId && link.to_unit_id!==unitId) throw new Error("Link does not belong to this node.");
    if (!removed) {
      const endpoints=await client.from("units").select("id").in("id",[link.from_unit_id,link.to_unit_id]).is("retired_at",null);
      if(endpoints.error) throw new Error(endpoints.error.message);
      if(endpoints.data.length!==2) throw new Error("Cannot restore a link to a retired claim.");
      const duplicate=await client.from("relationships").select("id").eq("from_unit_id",link.from_unit_id).eq("to_unit_id",link.to_unit_id).eq("type",link.type).is("retired_at",null).neq("id",linkId);
      if(duplicate.error) throw new Error(duplicate.error.message);
      if(duplicate.data.length) throw new Error("An active link already exists.");
    }
    const input = { type: link.type, toUnitId: link.to_unit_id, graphLinkId: link.id, removed, expectedRetiredAt: link.retired_at };
    const result = await commitPersonEdit(supabaseRpc(client), removed ? "Remove link" : "Restore link", [{ type: "link", targetId: link.from_unit_id, expectedRevisionId: null, passageIds: [], speechAct: null, input }]);
    if (result.status !== "applied") throw new Error("Link changed. Refresh and try again.");
    return { changeSetId: result.changeSetId };
  });
}

export async function organizeGraphSelection(unitIds: string[], destinationPath: string, newName = "") {
  return toActionResult(async () => {
    await requireUser();
    const ids=[...new Set(z.array(z.uuid()).min(1).max(300).parse(unitIds))];
    destinationPath=z.string().trim().min(1).max(2000).parse(destinationPath);
    newName=z.string().trim().max(100).refine(n=>!n.includes("/")&&n!=="."&&n!=="..","Use a single domain name.").parse(newName);
    const client=getAdminSupabase();
    const [units,parent]=await Promise.all([
      client.from("units").select("id,current_revision_id").in("id",ids).is("retired_at",null),
      client.from("domains").select("id").eq("path",destinationPath).is("retired_at",null).single(),
    ]);
    if(units.error) throw new Error(units.error.message);
    if(parent.error) throw new Error("Choose an existing destination or parent domain.");
    if(units.data.length!==ids.length) throw new Error("Some selected claims are no longer active. Select again.");
    const path=newName?destinationPath+"/"+newName:destinationPath;
    if(newName){const existing=await client.from("domains").select("id").eq("path",path);if(existing.error)throw new Error(existing.error.message);if(existing.data.length)throw new Error("That domain already exists. Choose Move instead.");}
    const actions: import("@/lib/ai/types").DraftAction[]=[];
    if(newName) actions.push({type:"create_domain",targetId:null,expectedRevisionId:null,passageIds:[],speechAct:null,input:{name:newName,path,parentPath:destinationPath}});
    actions.push(...units.data.map(unit=>({type:"place_claim" as const,targetId:unit.id,expectedRevisionId:unit.current_revision_id,passageIds:[],speechAct:null,input:{domainPaths:[path],rationale:"Moved by the user from a graph selection."}})));
    const result=await commitPersonEdit(supabaseRpc(client),`Organize ${ids.length} selected claims in ${path}`,actions);
    return {changeSetId:result.changeSetId,status:result.status,applied:result.applied,total:actions.length};
  });
}
