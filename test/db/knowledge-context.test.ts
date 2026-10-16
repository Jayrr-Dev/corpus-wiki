import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

describe("revision knowledge context in PostgreSQL", () => {
 let store: Awaited<ReturnType<typeof portablePostgres>>;
 beforeAll(async () => { store = await portablePostgres(); }, 60000);
 afterAll(async () => { await store?.pg.close(); });
 const context: KnowledgeContext = { entities: [{ type: "company", key: "acme", role: "subject" }], applicability: { status: "scoped", entities: [{ type: "company", key: "acme" }], conditions: "employees" } };
 async function submit(type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null) {
  const draft = await store.db.call<{changeSetId:string}>("submit_change_set", {p_event_id:null,p_cause:"edit",p_actor:"person",p_summary:"Context test",p_trace:{},p_actions:[{type,input,targetId,expectedRevisionId,passageIds:[],speechAct:"stated"}]});
  const result = await store.db.call<{status:string}>("commit_change_set", {p_change_set_id:draft.changeSetId});
  const action = (await store.pg.query<{target_id:string;after_revision_id:string}>("select target_id,after_revision_id from actions where change_set_id=$1",[draft.changeSetId])).rows[0]!;
  return {...draft,...action,...result};
 }
 it("stores context, preserves on legacy revision, replaces and restores on undo", async () => {
  await store.pg.exec("insert into entities(type,key,name) values ('company','acme','Acme'),('company','other','Other')");
  const added = await submit("add_claim", { content:"Orientation required",kind:"fact",epistemicStatus:"supported",entities:context.entities,domainPaths:[],context });
  expect(added.status).toBe("applied");
  const current = async () => (await store.pg.query<{knowledge_context:KnowledgeContext}>("select r.knowledge_context from units u join revisions r on r.id=u.current_revision_id where u.id=$1",[added.target_id])).rows[0]!.knowledge_context;
  expect(await current()).toEqual(context);
  const preserved = await submit("revise_claim", {content:"Orientation is required"}, added.target_id,added.after_revision_id);
  expect(await current()).toEqual(context);
  const general = {entities:[],applicability:{status:"general",entities:[],conditions:null}};
  const replaced = await submit("revise_claim", {content:"Orientation is required",context:general},added.target_id,preserved.after_revision_id);
  expect(await current()).toEqual(general);
  expect((await store.pg.query("select * from unit_entities where unit_id=$1",[added.target_id])).rows).toHaveLength(0);
  await store.db.call("revert_change_set",{p_change_set_id:replaced.changeSetId});
  expect(await current()).toEqual(context);
  expect((await store.pg.query("select * from unit_entities where unit_id=$1",[added.target_id])).rows).toHaveLength(1);
 });
 it("rejects unknown entities and conflicting or unspecified duplicate scopes", async () => {
  const invalid = await submit("add_claim", {content:"invalid",kind:"fact",epistemicStatus:"supported",entities:[],domainPaths:[],context:{...context,entities:[{type:"person",key:"missing",role:"subject"}]}});
  expect(invalid.status).toBe("rejected");
  const make = (c:KnowledgeContext) => submit("add_claim",{content:"Same wording",kind:"fact",epistemicStatus:"supported",entities:c.entities,domainPaths:[],context:c});
  const a=await make(context), b=await make({...context,applicability:{...context.applicability,entities:[{type:"company",key:"other"}]}});
  const rejected=await submit("merge_duplicates",{duplicateUnitIds:[b.target_id],autoMerge:true},a.target_id,a.after_revision_id);
  expect(rejected.status).toBe("rejected");
  const c=await make(context);
  expect((await submit("merge_duplicates",{duplicateUnitIds:[c.target_id],autoMerge:true},a.target_id,a.after_revision_id)).status).toBe("applied");
  expect((await store.pg.query("select passage_ids,knowledge_context from revisions where id=$1",[c.after_revision_id])).rows).toHaveLength(1);
 });
});
