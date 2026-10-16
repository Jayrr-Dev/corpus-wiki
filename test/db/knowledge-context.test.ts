import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

describe("revision knowledge context in PostgreSQL", () => {
 let store: Awaited<ReturnType<typeof portablePostgres>>;
 beforeAll(async () => { store = await portablePostgres(); }, 60000);
 afterAll(async () => { await store?.pg.close(); });
 const context: KnowledgeContext = { entities: [{ type: "company", key: "acme", role: "subject" }], applicability: { status: "scoped", entities: [{ type: "company", key: "acme" }], conditions: "employees" } };
 async function submit(type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null, passageIds: string[] = []) {
  const draft = await store.db.call<{changeSetId:string;eventId:string}>("submit_change_set", {p_event_id:null,p_cause:"edit",p_actor:"person",p_summary:"Context test",p_trace:{},p_actions:[{type,input,targetId,expectedRevisionId,passageIds,speechAct:"stated"}]});
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
  const conflicting=await submit("add_claim",{content:"Conflicting roles",kind:"fact",epistemicStatus:"supported",entities:[],domainPaths:[],context:{...context,entities:[...context.entities,{...context.entities[0],role:"mentioned"}]}});
  expect(conflicting.status).toBe("rejected");

  const make = (c:KnowledgeContext) => submit("add_claim",{content:"Same wording",kind:"fact",epistemicStatus:"supported",entities:c.entities,domainPaths:[],context:c});
  const unknown:KnowledgeContext={...context,applicability:{status:"unspecified",entities:[],conditions:null}};
  const unresolvedA=await make(unknown), unresolvedB=await make(unknown);
  expect((await submit("merge_duplicates",{duplicateUnitIds:[unresolvedB.target_id],autoMerge:true},unresolvedA.target_id,unresolvedA.after_revision_id)).status).toBe("rejected");
  const a=await make(context), b=await make({...context,applicability:{...context.applicability,entities:[{type:"company",key:"other"}]}});
  const rejected=await submit("merge_duplicates",{duplicateUnitIds:[b.target_id],autoMerge:true},a.target_id,a.after_revision_id);
  expect(rejected.status).toBe("rejected");
  const c=await make(context);
  expect((await submit("merge_duplicates",{duplicateUnitIds:[c.target_id],autoMerge:true},a.target_id,a.after_revision_id)).status).toBe("applied");
  expect((await store.pg.query("select passage_ids,knowledge_context from revisions where id=$1",[c.after_revision_id])).rows).toHaveLength(1);
 });
 it("selects about and scope-only claims independently, excludes mentions, and invalidates old unbuilt scope pages", async () => {
  const p = (await store.pg.query<{id:string}>("insert into pages(title,slug) values('Context test','context-test') returning id")).rows[0]!.id;
  const section = async (key:string,position:number) => (await store.pg.query<{id:string}>("insert into sections(page_id,position,title,query,status) values($1,$2,$3,$4,'current') returning id",[p,position,key,JSON.stringify({entity:{type:"company",key}})])).rows[0]!.id;
  const acme = await section("acme",0), other = await section("other",1);
  const scopeOnly:KnowledgeContext={entities:[],applicability:{status:"scoped",entities:[{type:"company",key:"acme"}],conditions:null}};
  const added=await submit("add_claim",{content:"Scope only",kind:"fact",epistemicStatus:"supported",entities:[],domainPaths:[],context:scopeOnly});
  const query = async(key:string) => (await store.pg.query<{id:string}>("select public.living_page_query_units($1) id",[JSON.stringify({entity:{type:"company",key}})])).rows.map(r=>r.id);
  expect(await query("acme")).toContain(added.target_id);
  const next={...scopeOnly,applicability:{...scopeOnly.applicability,entities:[{type:"company",key:"other"}]}};
  const revision=await submit("revise_claim",{content:"Scope only",context:next},added.target_id,added.after_revision_id);
  expect(await query("acme")).not.toContain(added.target_id);
  expect(await query("other")).toContain(added.target_id);
  const affected=await store.db.call<{sectionId:string}[]>("list_affected_sections",{p_event_id:revision.eventId});
  expect(affected.map(s=>s.sectionId)).toEqual(expect.arrayContaining([acme,other]));
  const about=await submit("add_claim",{content:"About Acme but scoped to Other",kind:"fact",epistemicStatus:"supported",entities:context.entities,domainPaths:[],context:{...next,entities:context.entities}});
  expect(await query("acme")).toContain(about.target_id);
  expect(await query("other")).toContain(about.target_id);
  const mention=await submit("add_claim",{content:"Mention only",kind:"fact",epistemicStatus:"supported",entities:[],domainPaths:[],context:{entities:[{type:"company",key:"acme",role:"mentioned"}],applicability:{status:"general",entities:[],conditions:null}}});
  expect(await query("acme")).not.toContain(mention.target_id);
 });
 it("consolidates source citations and mentions into a new revision and restores both units on undo", async () => {
  const passages=(await store.pg.query<{id:string}>("select id from passages order by id limit 2")).rows.map(r=>r.id);
  expect(passages).toHaveLength(2);
  const make=(c:KnowledgeContext,passage:string)=>submit("add_claim",{content:"Equivalent evidence",kind:"fact",epistemicStatus:"supported",entities:c.entities,domainPaths:[],context:c},null,null,[passage]);
  const a=await make(context,passages[0]!);
  const mentioned:KnowledgeContext={...context,entities:[...context.entities,{type:"company",key:"other",role:"mentioned"}]};
  const b=await make(mentioned,passages[1]!);
  const merged=await submit("merge_duplicates",{duplicateUnitIds:[b.target_id],autoMerge:true},a.target_id,a.after_revision_id);
  expect(merged.status).toBe("applied");
  expect(merged.after_revision_id).not.toBe(a.after_revision_id);
  const saved=(await store.pg.query<{passage_ids:string[];knowledge_context:KnowledgeContext}>("select passage_ids,knowledge_context from revisions where id=$1",[merged.after_revision_id])).rows[0]!;
  expect(saved.passage_ids).toEqual(expect.arrayContaining(passages));
  expect(saved.knowledge_context.entities).toContainEqual(mentioned.entities[1]);
  await store.db.call("revert_change_set",{p_change_set_id:merged.changeSetId});
  const restored=(await store.pg.query<{current_revision_id:string;retired_at:string|null}>("select current_revision_id,retired_at from units where id=$1",[a.target_id])).rows[0]!;
  expect(restored.current_revision_id).toBe(a.after_revision_id);
  expect((await store.pg.query<{retired_at:null}>("select retired_at from units where id=$1",[b.target_id])).rows[0]!.retired_at).toBeNull();
 });

 it("clears the current projection when undo restores unknown historical context", async () => {
  // Seed is loaded after migrations and models an old revision without a snapshot.
  const legacy=(await store.pg.query<{id:string;current_revision_id:string;content:string}>("select u.id,u.current_revision_id,r.content from units u join revisions r on r.id=u.current_revision_id where r.knowledge_context is null limit 1")).rows[0]!;
  expect(legacy).toBeDefined();
  const revised=await submit("revise_claim",{content:legacy.content,context},legacy.id,legacy.current_revision_id);
  expect(revised.status).toBe("applied");
  await store.db.call("revert_change_set",{p_change_set_id:revised.changeSetId});
  expect((await store.pg.query("select * from unit_entities where unit_id=$1",[legacy.id])).rows).toHaveLength(0);
  expect((await store.pg.query<{knowledge_context:null}>("select knowledge_context from revisions where id=$1",[legacy.current_revision_id])).rows[0]!.knowledge_context).toBeNull();
 });
 it("requires a new revision to change a known context snapshot", async () => {
  const added=await submit("add_claim",{content:"Immutable snapshot",kind:"fact",epistemicStatus:"supported",entities:context.entities,domainPaths:[],context});
  await expect(store.pg.query("update revisions set knowledge_context=null where id=$1",[added.after_revision_id])).rejects.toThrow("Knowledge context is immutable");
 });

});


it("migrates only current entity associations without inventing historical context", async () => {
 const pg = new PGlite({extensions:{vector}});
 try {
  await pg.exec(await readFile(resolve("test/db/supabase-stubs.sql"),"utf8"));
  const migrations=(await readdir(resolve("supabase/migrations"))).filter(file=>file.endsWith(".sql")).sort();
  for(const file of migrations.filter(file=>file < "20261105180000")) await pg.exec(await readFile(resolve("supabase/migrations",file),"utf8"));
  await pg.exec(await readFile(resolve("supabase/seed.sql"),"utf8"));
  const historical=(await pg.query<{id:string}>("insert into revisions(unit_id,content,passage_ids,source_date,event_id,author) select unit_id,'Historical wording',passage_ids,source_date,event_id,author from revisions limit 1 returning id")).rows[0]!.id;
  for(const file of migrations.filter(file=>file >= "20261105180000")) await pg.exec(await readFile(resolve("supabase/migrations",file),"utf8"));
  expect((await pg.query<{knowledge_context:null}>("select knowledge_context from revisions where id=$1",[historical])).rows[0]!.knowledge_context).toBeNull();
  const current=(await pg.query<{knowledge_context:KnowledgeContext}>("select r.knowledge_context from units u join revisions r on r.id=u.current_revision_id")).rows;
  expect(current.length).toBeGreaterThan(0);
  for(const row of current) {
   expect(row.knowledge_context.applicability.status).toBe("unspecified");
   expect(row.knowledge_context.entities.length).toBeGreaterThan(0);
  }
 } finally { await pg.close(); }
},60000);
