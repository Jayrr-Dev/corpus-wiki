import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { newArticleSections, orchestrateEventArticles } from "./articleOrchestrator";
import * as articlePlanner from "./articlePlanner";
import { OutlineRejectedError, type Attempt } from "./outlineBuilder";
import * as retrieval from "./articleKnowledgeCandidates";
import * as discovery from "./discoverArticleUpdates";
import * as scaffold from "./articleScaffold";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("gathers relevant saved knowledge before planning the complete initial scaffold", async () => {
  const candidateSearch = vi.spyOn(retrieval, "articleKnowledgeCandidates").mockResolvedValue(["extra", "unrelated"]);
  const selection = vi.spyOn(discovery, "groupClaimsForArticle").mockResolvedValue({ sections: [{ title: "Provisional batch heading", query: { unitIds: ["extra"] } }], excluded: [], tokensIn: 2, tokensOut: 3 });
  const planning = vi.spyOn(articlePlanner, "planArticle").mockResolvedValue({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "Complete structure", claims: ["C2"] }] }, tokensIn: 5, tokensOut: 6 });
  const rows: Record<string, unknown> = { units: ["extra", "unrelated"].map(id => ({ id, current_revision_id: `r-${id}`, kind: "fact", epistemic_status: "established" })),
    revisions: ["extra", "unrelated"].map(id => ({ id: `r-${id}`, content: `Fact ${id}`, knowledge_context: null })), unit_entities: [], unit_domains: [] };
  const client = { from: (table: string) => {
    const chain = { select: () => chain, in: () => chain, is: () => chain, neq: () => chain, order: () => chain, range: () => chain,
      then: (resolve: (result: object) => unknown) => Promise.resolve(resolve({ data: rows[table] ?? [], error: null })) };
    return chain;
  } } as unknown as AdminSupabase;
  const result = await newArticleSections({ db: { call: vi.fn() }, client, settings: { apiKey: "test" }, embedder: null }, {
    action: "create", title: "Subject", scope: "This subject only", type: "concept", entity: null, parentPageId: null,
    claims: [{ unitId: "seed", revisionId: "r-seed", content: "The seed fact", kind: "fact", epistemicStatus: "established", topics: [], entityIds: [] }],
  });
  expect(candidateSearch.mock.invocationCallOrder[0]).toBeLessThan(selection.mock.invocationCallOrder[0]!);
  expect(selection.mock.invocationCallOrder[0]).toBeLessThan(planning.mock.invocationCallOrder[0]!);
  expect(planning.mock.calls[0]![1].units.map(unit => unit.unitId)).toEqual(["seed", "extra"]);
  expect(result.sections[0]?.title).toBe("Complete structure");
  expect(result).toMatchObject({ tokensIn: 7, tokensOut: 9 });
});

it("drops the entity filter from an entity article's sections that list their claims", async () => {
  vi.spyOn(retrieval, "articleKnowledgeCandidates").mockResolvedValue([]);
  vi.spyOn(articlePlanner, "planArticle").mockResolvedValue({ plan: { title: "Food bank", introduction: ["C1"], sections: [{ title: "Visits", claims: ["C2"] }] }, tokensIn: 1, tokensOut: 1 });
  const client = { from: () => {
    const chain = { select: () => chain, in: () => chain, is: () => chain, neq: () => chain, order: () => chain, range: () => chain,
      then: (resolve: (result: object) => unknown) => Promise.resolve(resolve({ data: [], error: null })) };
    return chain;
  } } as unknown as AdminSupabase;
  const claim = (id: string) => ({ unitId: id, revisionId: `r-${id}`, content: `Fact ${id}`, kind: "definition" as const, epistemicStatus: "established" as const, topics: [], entityIds: [] });
  const { sections } = await newArticleSections({ db: { call: vi.fn() }, client, settings: { apiKey: "test" }, embedder: null }, {
    action: "create", title: "Food bank", scope: "The food bank", type: "entity", parentPageId: null,
    entity: { id: "e1", type: "organization", key: "food-bank", name: "Food bank" }, claims: [claim("a"), claim("b")],
  });
  expect(sections.length).toBeGreaterThan(0);
  for (const section of sections) {
    expect(section.query.unitIds?.length).toBeGreaterThan(0);
    expect(section.query).not.toHaveProperty("entity");
  }
});

it.each(["quality", "transport"])("records an editorial rejection but keeps a %s failure distinct", async (failure) => {
  const attempt: Attempt = { plan: { title: "Recorded subject", introduction: ["C1"], sections: [{ title: "Recorded details", claims: ["C2", "C3"] }] },
    centralMessage: null, readingOrderRationale: null, problems: ["A heading promises unsupported facts."], review: null, accepted: false };
  vi.spyOn(articlePlanner, "planArticle").mockRejectedValue(failure === "quality"
    ? new OutlineRejectedError([attempt], { tokensIn: 7, tokensOut: 8 }) : new Error("Provider interrupted"));
  const units = [1, 2, 3].map(id => ({ id: `u${id}`, current_revision_id: `r${id}`, kind: "fact", epistemic_status: "supported" }));
  const rows: Record<string, unknown> = { units, revisions: units.map(unit => ({ id: unit.current_revision_id, content: `Fact ${unit.id}`, knowledge_context: null })), unit_entities: [], unit_domains: [] };
  const audits: Record<string, unknown>[] = [];
  const client = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, neq: () => query, order: () => query, range: () => query,
      upsert: async (row: Record<string, unknown>) => { audits.push(row); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows[table], error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  const checkpoints = new Map<string, unknown>();
  const db: DbRpc = { call: vi.fn(async (name, args: RpcArgs = {}) => {
    if (name === "report_upload_progress") return null;
    if (name === "living_page_event_units") return units.map(unit => unit.id);
    if (name === "get_workspace_settings") return {};
    if (name === "article_knowledge_candidates") return [];
    if (name === "article_index") return [];
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: checkpoints.has(key), output: checkpoints.get(key) };
    if (name === "read_completed_upload_step") return { done: checkpoints.has(key), output: checkpoints.get(key) };
    if (name === "finish_upload_step") { if (!args.p_error) checkpoints.set(key, args.p_output); return null; }
    throw new Error(`Unexpected write: ${name}`);
  }) as DbRpc["call"] };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const value = request.response_format.json_schema.name === "article_proposals"
      ? { proposals: [{ action: "create", pageId: null, title: "Recorded subject", type: "concept", scope: "The recorded facts", parentPageId: null, entity: null, claims: ["C1", "C2", "C3"] }] }
      : { checks: { distinct: true, standalone: true, substantive: true, inScope: true, typeFits: true }, verdict: "approve", targetPageId: null, sectionTitle: null, reason: "A distinct subject." };
    return new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
  }));
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => orchestrateEventArticles({ db, client, settings: { apiKey: "test" }, embedder: null }, "upload"));
  if (failure === "transport") {
    await expect(run()).rejects.toThrow("Provider interrupted");
    expect(audits).toHaveLength(0);
  } else {
    await expect(run()).resolves.toMatchObject({ rejected: 1, created: 0 });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ verdict: "reject", result_page_id: null, change_set_id: null,
      proposal: { claimIds: ["u1", "u2", "u3"], outlineReview: { attempts: [attempt] } } });
    await expect(run()).resolves.toMatchObject({ rejected: 1 });
    expect(articlePlanner.planArticle).toHaveBeenCalledTimes(1);
    expect(audits).toHaveLength(1);
    // Simulate a saved rejection from the contradictory older rubric. A new
    // independent decision must be audited once without rewriting history.
    for (const value of checkpoints.values()) {
      const saved = value as { verdict?: string; outlinePolicyVersion?: string; outlineReview?: { policyVersion: string } };
      if (saved?.outlineReview) saved.outlineReview.policyVersion = "article-outline-v6-scoped-evidence";
      if (saved?.verdict === "reject") delete saved.outlinePolicyVersion;
    }
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ checks: { distinct: true, standalone: false, substantive: true, inScope: true, typeFits: true },
        verdict: "reject", targetPageId: null, sectionTitle: null, reason: "A fresh independent decision using the current index." }) } }] })));
    await expect(run()).resolves.toMatchObject({ rejected: 1 });
    expect(audits).toHaveLength(2);
    expect(audits[0]!.id).not.toBe(audits[1]!.id);
    const callsAfterRecovery = vi.mocked(fetch).mock.calls.length;
    await expect(run()).resolves.toMatchObject({ rejected: 1 });
    expect(audits).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(callsAfterRecovery);
  }
});

it("records a rejected re-plan of an existing article as a decision, not a failed upload", async () => {
  const attempt: Attempt = { plan: { title: "Existing article", introduction: ["C1"], sections: [] },
    centralMessage: null, readingOrderRationale: null, problems: ["A section repeats another."], review: null, accepted: false };
  const replan = vi.spyOn(scaffold, "articleAdditionActions").mockRejectedValue(new OutlineRejectedError([attempt], { tokensIn: 3, tokensOut: 4 }));
  onTestFinished(() => replan.mockRestore());
  const tables: Record<string, unknown> = {
    units: [{ id: "u1", current_revision_id: "r1", kind: "fact", epistemic_status: "supported" }],
    revisions: [{ id: "r1", content: "A supported fact.", knowledge_context: null }],
    unit_entities: [], unit_domains: [], pages: { title: "Existing article" }, sections: [], section_lines: [],
  };
  const audits: Record<string, unknown>[] = [];
  const client = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, neq: () => query, order: () => query, range: () => query, single: () => query,
      upsert: async (row: Record<string, unknown>) => { audits.push(row); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  const steps = new Map<string, unknown>();
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "report_upload_progress") return null as T;
    if (name === "living_page_event_units") return ["u1"] as T;
    if (name === "article_index") return [{ id: "page" }] as T;
    if (name === "get_workspace_settings") return {} as T;
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: steps.has(key), output: steps.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) steps.set(key, args.p_output); return null as T; }
    throw new Error(`Unexpected database call ${name}`);
  } };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const value = request.response_format.json_schema.name === "article_proposals"
      ? { proposals: [{ action: "update", pageId: "page", title: "", type: null, scope: "", parentPageId: null, entity: null, claims: ["C1"] }] }
      : { sections: [{ title: "Supported knowledge", claims: ["C1"] }] };
    return new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
  }));
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => orchestrateEventArticles({ db, client, settings: { apiKey: "test" }, embedder: null }, "upload"));
  await expect(run()).resolves.toMatchObject({ rejected: 1, updated: 0 });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ verdict: "reject", change_set_id: null, proposal: { claimIds: ["u1"], outlineReview: { attempts: [attempt] } } });
  expect(String(audits[0]!.reason)).toMatch(/^The article was not changed/);
});

it.each(["audit", "lost-audit", "commit"])("does not complete an upload proposal after a failed %s", async (failure) => {
  let failRecord = failure !== "commit";
  const records: unknown[] = [];
  const savedIds = new Set<string>();
  const tables: Record<string, unknown> = {
    units: [{ id: "u1", current_revision_id: "r1", kind: "fact", epistemic_status: "supported" }],
    revisions: [{ id: "r1", content: "A supported fact.", knowledge_context: null }],
    unit_entities: [], unit_domains: [], pages: { title: "Existing article" }, sections: [], section_lines: [],
  };
  const client = { from: (table: string) => {
    const save = async (row: { id: string }) => {
      if (!failRecord || failure === "lost-audit") {
        if (!savedIds.has(row.id)) { savedIds.add(row.id); records.push(row); }
      }
      if (failRecord) { failRecord = false; return { error: { message: "Audit storage unavailable" } }; }
      return { error: null };
    };
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, neq: () => query, order: () => query, range: () => query, single: () => query,
      insert: save, upsert: save,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  const steps = new Map<string, unknown>();
  const writes = new Map<string, unknown>();
  let commits = 0;
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "report_upload_progress") return null as T;
    if (name === "living_page_event_units") return ["u1"] as T;
    if (name === "article_index") return [{ id: "page" }] as T;
    if (name === "get_workspace_settings") return {} as T;
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: steps.has(key), output: steps.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) steps.set(key, args.p_output); return null as T; }
    if (name === "upload_workflow_write") {
      if (writes.has(key)) return writes.get(key) as T;
      const result = args.p_function === "submit_change_set" ? { changeSetId: "proposal" }
        : (++commits, { status: failure === "commit" ? "partly_applied" : "applied", applied: 1, rejected: failure === "commit" ? 1 : 0, exceptions: 0 });
      writes.set(key, result); return result as T;
    }
    throw new Error(`Unexpected database call ${name}`);
  } };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const value = request.response_format.json_schema.name === "article_proposals"
      ? { proposals: [{ action: "update", pageId: "page", title: "", type: null, scope: "", parentPageId: null, entity: null, claims: ["C1"] }] }
      : { sections: [{ title: "Supported knowledge", claims: ["C1"] }] };
    return new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
  }));
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => orchestrateEventArticles({ db, client, settings: { apiKey: "test" }, embedder: null }, "upload"));
  await expect(run()).rejects.toThrow(failure !== "commit" ? "Audit storage unavailable" : "Article proposal was not fully applied");
  expect(records).toHaveLength(failure === "lost-audit" ? 1 : 0);
  if (failure !== "commit") {
    await expect(run()).resolves.toMatchObject({ updated: 1 });
    expect(records).toHaveLength(1);
    expect(commits).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  }
});

it.each([2, 3])("retries failed upload proposals for %i claims while reusing completed proposals and keeping reference validation", async (claimCount) => {
  const units = Array.from({ length: claimCount }, (_, index) => index + 1).map((id) => ({ id: `u${id}`, current_revision_id: `r${id}`, kind: "fact", epistemic_status: "established" }));
  const tables: Record<string, unknown> = {
    units, revisions: units.map((unit) => ({ id: unit.current_revision_id, content: `Fact ${unit.id}`, knowledge_context: null })),
    unit_entities: [], unit_domains: [], pages: { title: "Existing article" }, sections: [], section_lines: [],
  };
  const records: Record<string, unknown>[] = [];
  const client = { from: (table: string) => {
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, in: () => chain, neq: () => chain, order: () => chain, range: () => chain, single: () => chain,
      insert: async (row: Record<string, unknown>) => { records.push(row); return { error: null }; },
      upsert: async (row: Record<string, unknown>) => { records.push(row); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })),
    };
    return chain;
  } } as unknown as AdminSupabase;
  const checkpoints = new Map<string, { state: string; output: unknown }>();
  // Match a jsonb round trip: nested object-key order differs from model output.
  const jsonb = (value: unknown): unknown => Array.isArray(value) ? value.map(jsonb)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, jsonb(part)])) : value;
  const call = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    if (name === "report_upload_progress") return null;
    if (name === "living_page_event_units") return units.map((unit) => unit.id);
    if (name === "article_index") return [{ id: "page-a" }, { id: "page-b" }];
    if (name === "get_workspace_settings") return {};
    if (name === "assert_upload_lease") return null;
    const key = String(args.p_key);
    if (name === "start_upload_step") {
      const prior = checkpoints.get(key);
      return { done: prior?.state === "succeeded", output: prior?.output };
    }
    if (name === "finish_upload_step") {
      checkpoints.set(key, { state: args.p_error ? "failed" : "succeeded", output: jsonb(args.p_output) });
      return null;
    }
    throw new Error(`Unexpected database call: ${name}`);
  });
  const db = { call: call as DbRpc["call"] };
  const proposal = (pageId: string, claims: string[]) => ({ action: "update", pageId, title: "", type: null, scope: "", parentPageId: null, entity: null, claims });
  const answer = (value: unknown) => new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
  const invalid = { sections: [{ title: "Unknown claims", claims: ["C99"] }] };
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(answer({ proposals: [proposal("page-a", claimCount === 2 ? ["C1"] : ["C1", "C2"]), proposal("page-b", [`C${claimCount}`])] }))
    .mockResolvedValueOnce(answer(invalid)).mockResolvedValueOnce(answer(invalid))
    .mockResolvedValueOnce(answer({ sections: [], excluded: [{ claim: "C1", reason: "already_covered", explanation: "The current article states this fact." }] }))
    .mockResolvedValueOnce(answer({ sections: [], excluded: Array.from({ length: claimCount === 2 ? 1 : 2 }, (_, index) => ({ claim: `C${index + 1}`, reason: "already_covered", explanation: "The current article states this fact." })) }));
  vi.stubGlobal("fetch", fetcher);
  const deps = { db, client, settings: { apiKey: "test" }, embedder: null };
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => orchestrateEventArticles(deps, "upload"));
  await expect(run()).rejects.toThrow("invalid claim fields");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ verdict: "update_existing", result_page_id: "page-b" });
  expect(call.mock.calls.filter(([name]) => name === "report_upload_progress").map(([, args]) => args?.p_progress))
    .toEqual([{ step: "plan", done: 0, total: 2 }, { step: "plan", done: 1, total: 2 }]);
  expect([...checkpoints].filter(([key, step]) => step.state === "failed" && !key.endsWith(":prepare-v1"))).toHaveLength(1);
  expect([...checkpoints].filter(([key, step]) => step.state === "failed" && key.endsWith(":prepare-v1"))).toHaveLength(1);
  expect(await run()).toMatchObject({ updated: 2, rejected: 0, pageIds: ["page-a", "page-b"] });
  expect(records).toHaveLength(2);
  expect(records.every((row) => row.verdict === "update_existing")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect([...checkpoints.values()].every((step) => step.state === "succeeded")).toBe(true);
  expect(call.mock.calls.filter(([name]) => name === "report_upload_progress").at(-1)?.[1]?.p_progress)
    .toEqual({ step: "plan", done: 2, total: 2 });
});

it('resumes a long article proposal run without repeating earlier completed claim batches',async()=>{
 const units=Array.from({length:151},(_,index)=>({id:`u${String(index).padStart(4,'0')}`,current_revision_id:`r${index}`,kind:'fact',epistemic_status:'supported'}));
 const tables:Record<string,Record<string,unknown>[]>={units,revisions:units.map(unit=>({id:unit.current_revision_id,content:`Fact ${unit.id}`,knowledge_context:null})),unit_domains:[],unit_entities:[]};
 const client={from:(table:string)=>{
  let rows=[...(tables[table]??[])];
  const query={select:()=>query,is:()=>query,neq:()=>query,order:()=>query,
   in:(column:string,ids:string[])=>{rows=rows.filter(row=>ids.includes(String(row[column])));return query;},
   range:(from:number,to:number)=>{rows=rows.slice(from,to+1);return query;},
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(resolve({data:rows,error:null})),
  };return query;
 }} as unknown as AdminSupabase;
 const checkpoints=new Map<string,{state:string;output:unknown}>();
 const db:DbRpc={async call<T>(name:string,args:RpcArgs={}){
  if(name==='report_upload_progress')return null as T;
  if(name==='living_page_event_units')return units.map(unit=>unit.id) as T;
  if(name==='get_workspace_settings')return {} as T;
  if(name==='article_index')return [] as T;
  const key=String(args.p_key),prior=checkpoints.get(key);
  if(name==='start_upload_step')return {done:prior?.state==='succeeded',output:prior?.output} as T;
  if(name==='finish_upload_step'){checkpoints.set(key,{state:args.p_error?'failed':'succeeded',output:args.p_output});return null as T;}
  throw Error(name);
 }};
 const calls:number[]=[];let interrupted=false;
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  const request=JSON.parse(String(init?.body));
  const payload=JSON.parse(request.messages.find((message:{role:string})=>message.role==='user').content);
  calls.push(payload.claims.length);
  if(payload.claims.length===1&&!interrupted){interrupted=true;throw Error('Provider interrupted');}
  return new Response(JSON.stringify({model:'test',usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify({proposals:[]})}}]}));
 }));
 const run=()=>uploadExecution.run({eventId:'long-upload',token:'owner',db},()=>orchestrateEventArticles({db,client,settings:{apiKey:'test'},embedder:null},'long-upload'));
 await expect(run()).rejects.toThrow('Provider interrupted');
 expect([...checkpoints].filter(([key,value])=>/^article-proposal-batch:long-upload:[a-f0-9]{24}$/.test(key)&&value.state==='succeeded')).toHaveLength(1);
 await expect(run()).resolves.toMatchObject({created:0,updated:0});
 expect(calls).toEqual([150,1,1]);
});
vi.mock("./articleScaffold", () => ({ articleAdditionActions: vi.fn(async (_db, _client, _settings, pageId, sections) => sections.map((section: object) => ({ type: "create_section", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { pageId, ...section } }))) }));
