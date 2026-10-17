import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { commitPersonEdit } from "@/lib/change-control";

it("creates a domain for selected claims and restores memberships on undo",async()=>{
 const {pg,db}=await portablePostgres();
 try {
  const before=await pg.query("select unit_id,domain_id from unit_domains order by unit_id,domain_id");
  const units=await pg.query<{id:string;current_revision_id:string}>("select id,current_revision_id from units where retired_at is null order by id limit 2");
  const parent=await pg.query<{path:string}>("select path from domains where retired_at is null order by path limit 1");
  const path=parent.rows[0]!.path+"/Selection test";
  const result=await commitPersonEdit(db,"Selection test",[
   {type:"create_domain",targetId:null,expectedRevisionId:null,passageIds:[],speechAct:null,input:{name:"Selection test",path,parentPath:parent.rows[0]!.path}},
   ...units.rows.map(u=>({type:"place_claim" as const,targetId:u.id,expectedRevisionId:u.current_revision_id,passageIds:[],speechAct:null,input:{domainPaths:[path]}})),
  ]);
  expect(result.status).toBe("applied");
  expect(result.applied).toBe(3);
  expect((await pg.query("select ud.unit_id from unit_domains ud join domains d on d.id=ud.domain_id where d.path=$1",[path])).rows).toHaveLength(2);
  await db.call("revert_change_set",{p_change_set_id:result.changeSetId});
  expect((await pg.query("select unit_id,domain_id from unit_domains order by unit_id,domain_id")).rows).toEqual(before.rows);
 } finally {await pg.close();}
},120000);
