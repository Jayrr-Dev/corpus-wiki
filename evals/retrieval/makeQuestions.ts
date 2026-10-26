import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_AI_MODEL, TOKEN_FACTORY_BASE_URL } from "../../lib/ai/config.ts";

// =====================================================================
// RETRIEVAL QUESTION SET (C1 of "Plan: hybrid chat search" in TODO.md)
// Samples live claims from the live database, READ-ONLY, and asks the chat
// model to write one natural question per claim that the claim answers,
// without copying its distinctive words. Writes evals/retrieval/questions.json.
//
//   node --experimental-strip-types --env-file=<path to .env.local> evals/retrieval/makeQuestions.ts
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEBIUS_API_KEY
// (AI_MODEL optional). Sends claim text to Nebius Token Factory.
// =====================================================================

// SETTINGS
const SEED = 20261026;
const TARGET = 60;
const ENTITY_TARGET = 10;
const MIN_CONTENT_CHARS = 60;
// Two claims at or above this cosine similarity say the same thing
const DUPLICATE_SIMILARITY = 0.9;
const EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B";
const OUTPUT = join(import.meta.dirname, "questions.json");

// TYPES
type Claim = {
  unitId: string;
  revisionId: string;
  kind: string;
  title: string;
  content: string;
  context: unknown;
  domainPaths: string[];
  contextEntityIds: string[];
};
type Entity = { id: string; type: string; key: string; name: string };
type Question = { id: string; question: string; unitIds: string[]; entityId: string | null; claimTitle: string };

const env = process.env;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
if (!env.NEBIUS_API_KEY) throw new Error("Set NEBIUS_API_KEY.");
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// AI_MODEL may name another provider ("cerebras/...", "anthropic/..."); questions stay on Token Factory
const model = env.AI_MODEL && !/^(cerebras|anthropic)\//.test(env.AI_MODEL) ? env.AI_MODEL : DEFAULT_AI_MODEL;

// =====================================================================
// READING THE LIVE DATABASE (selects and stable functions only)
// =====================================================================

// Every row of a table whose `nullColumns` are null, 500 at a time in a fixed order
async function readAll<Row>(table: string, columns: string, order: string[], nullColumns: string[] = []): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; ; start += 500) {
    let query = client.from(table).select(columns);
    for (const column of nullColumns) query = query.is(column, null);
    for (const column of order) query = query.order(column);
    const result = await query.range(start, start + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data as unknown as Row[]));
    if (result.data.length < 500) return rows;
  }
}

// Rows whose `column` is in `ids`, in chunks so the URL stays short
async function readIn<Row>(table: string, columns: string, column: string, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const result = await client.from(table).select(columns).in(column, ids.slice(start, start + 100));
    if (result.error) throw result.error;
    rows.push(...(result.data as unknown as Row[]));
  }
  return rows;
}

async function loadClaims(): Promise<{ claims: Claim[]; entities: Map<string, Entity> }> {
  const units = await readAll<{ id: string; kind: string; current_revision_id: string }>("units", "id,kind,current_revision_id", ["id"], ["retired_at"]);
  const revisions = await readIn<{ id: string; title: string | null; content: string; knowledge_context: unknown }>("revisions", "id,title,content,knowledge_context", "id", units.map(unit => unit.current_revision_id));
  const memberships = await readAll<{ unit_id: string; domain_id: string }>("unit_domains", "unit_id,domain_id", ["unit_id", "domain_id"]);
  const domains = await readAll<{ id: string; path: string; context_entity_id: string | null }>("domains", "id,path,context_entity_id", ["id"], ["retired_at"]);
  const entityRows = await readAll<Entity>("entities", "id,type,key,name", ["id"], ["retired_at", "merged_into_id"]);
  const revisionById = new Map(revisions.map(revision => [revision.id, revision]));
  const domainById = new Map(domains.map(domain => [domain.id, domain]));
  const domainsByUnit = new Map<string, typeof domains>();
  for (const membership of memberships) {
    const domain = domainById.get(membership.domain_id);
    if (domain) domainsByUnit.set(membership.unit_id, [...(domainsByUnit.get(membership.unit_id) ?? []), domain]);
  }
  const claims: Claim[] = [];
  for (const unit of units) {
    const revision = revisionById.get(unit.current_revision_id);
    if (!revision?.title) continue;
    const unitDomains = domainsByUnit.get(unit.id) ?? [];
    claims.push({
      unitId: unit.id,
      revisionId: revision.id,
      kind: unit.kind,
      title: revision.title,
      content: revision.content,
      context: revision.knowledge_context,
      domainPaths: unitDomains.map(domain => domain.path).sort(),
      contextEntityIds: [...new Set(unitDomains.flatMap(domain => (domain.context_entity_id ? [domain.context_entity_id] : [])))].sort(),
    });
  }
  return { claims, entities: new Map(entityRows.map(entity => [entity.id, entity])) };
}

// Other live claims that may say the same thing, through the same vector function search uses
async function nearDuplicates(claim: Claim): Promise<{ unitId: string; content: string }[]> {
  const vector = await client.from("unit_embeddings").select("embedding").eq("revision_id", claim.revisionId).eq("model", EMBEDDING_MODEL).maybeSingle();
  if (vector.error) throw vector.error;
  if (!vector.data) return [];
  const embedding = vector.data.embedding as unknown;
  const matches = await client.rpc("similar_units", { p_embedding: typeof embedding === "string" ? embedding : JSON.stringify(embedding), p_model: EMBEDDING_MODEL, p_limit: 6, p_min: DUPLICATE_SIMILARITY });
  if (matches.error) throw matches.error;
  return (matches.data as { unit_id: string; content: string }[])
    .filter(match => match.unit_id !== claim.unitId)
    .map(match => ({ unitId: match.unit_id, content: match.content }))
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
}

// The live claims an entity's page covers, which is the scope chat searches when that entity is chosen
async function entityScope(entity: Entity): Promise<Set<string>> {
  const result = await client.rpc("living_page_query_units", { p_query: { entity: { type: entity.type, key: entity.key } } });
  if (result.error) throw result.error;
  return new Set(result.data as string[]);
}

// =====================================================================
// SAMPLING (seeded, so the same database gives the same sample)
// =====================================================================

// mulberry32: a small seeded random number generator
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const item = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = item;
  }
  return copy;
}

// Topic group: the first two levels of the claim's first domain path ("Company/Topic")
function topicOf(claim: Claim): string {
  return claim.domainPaths[0]?.split("/").slice(0, 2).join("/") ?? "(no domain)";
}

// Lowercase words of five letters or more: the claim's distinctive vocabulary
function distinctiveWords(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? []);
}

// Round-robin over topic groups, then over kinds within each topic, so no area dominates
function spreadOrder(claims: Claim[], random: () => number): Claim[] {
  const byTopic = new Map<string, Claim[]>();
  for (const claim of shuffle(claims, random)) byTopic.set(topicOf(claim), [...(byTopic.get(topicOf(claim)) ?? []), claim]);
  const queues = [...byTopic.keys()].sort().map(topic => {
    const byKind = new Map<string, Claim[]>();
    for (const claim of byTopic.get(topic)!) byKind.set(claim.kind, [...(byKind.get(claim.kind) ?? []), claim]);
    const kinds = [...byKind.values()];
    const ordered: Claim[] = [];
    while (kinds.some(list => list.length)) for (const list of kinds) if (list.length) ordered.push(list.shift()!);
    return ordered;
  });
  const order: Claim[] = [];
  while (queues.some(queue => queue.length)) for (const queue of shuffle(queues, random)) if (queue.length) order.push(queue.shift()!);
  return order;
}

// =====================================================================
// WRITING QUESTIONS (Nebius Token Factory, OpenAI-compatible)
// =====================================================================

// One completion's text, without any thinking block
async function askModel(system: string, user: string): Promise<string> {
  const response = await fetch(`${TOKEN_FACTORY_BASE_URL}chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      seed: SEED,
      max_tokens: 2000,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      // Nemotron 3 spends its budget on hidden reasoning unless thinking is off (see lib/ai/chat.ts)
      ...(/nemotron-3/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: "low" }),
    }),
  });
  if (!response.ok) throw new Error(`Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return (body.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
}

async function askQuestion(user: string): Promise<string> {
  const text = await askModel(SYSTEM, user);
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  const question = json ? (JSON.parse(json) as { question?: unknown }).question : undefined;
  if (typeof question !== "string" || !question.trim()) throw new Error(`No question in answer: ${text.slice(0, 200)}`);
  return question.trim();
}

// Similar wording is not the same answer ("1.0m to gas lines" vs "1.8m to water lines"),
// so a vector match joins unitIds only if the model says it answers the question as fully
const JUDGE = `You check a search test. Given a question, the claim it was written from (A) and another claim (B), say whether B alone answers the question as fully and correctly as A.
Answer false if B gives different numbers, a different step, a different item or only part of the answer.
Return only JSON: {"answers": true} or {"answers": false}`;

async function sameAnswer(question: string, claim: Claim, other: string): Promise<boolean> {
  // Read the verdict by pattern: the model sometimes returns slightly broken JSON here
  const text = await askModel(JUDGE, `Question: ${question}\nA: ${claim.content}\nB: ${other}`);
  const verdict = text.match(/"answers"\s*:\s*"?(true|false)/)?.[1];
  if (!verdict) throw new Error(`No verdict in answer: ${text.slice(0, 200)}`);
  return verdict === "true";
}

const SYSTEM = `You write test questions for a search engine over a company knowledge base.
Given one saved claim, write ONE natural question a colleague would type into the knowledge base's chat that this claim answers.
Rules:
- Ask about what the claim tells you; the claim must be a good answer.
- The knowledge base covers several companies and many topics, so be specific enough that this claim is clearly the best answer, not one of dozens. Avoid vague words like "our company" or "the process" without saying which.
- Reword: do not reuse the claim's distinctive words or phrases. Use synonyms or everyday wording, the way someone who has not read the claim would ask.
- One sentence, under 25 words, no quotation marks, no mention of "the claim" or "the document".
Return only JSON: {"question": "..."}`;

function userPrompt(claim: Claim, entity: Entity | null): string {
  const scope = entity
    ? `\nThe question must only make sense for ${entity.name}: name it in the question (for example "At ${entity.name}, ..." or "For ${entity.name}, ..."). Leave out other details that would identify the claim without that context.`
    : `\nDo not name the company or organization; ask the way someone already working there would.`;
  return `Claim title: ${claim.title}\nClaim: ${claim.content}\nTopic: ${claim.domainPaths[0] ?? "none"}${scope}`;
}

// Writes the question; asks once more if it copies too many of the claim's distinctive words,
// or if a question searched across every company says "our" or "we" without naming whose
async function writeQuestion(claim: Claim, entity: Entity | null): Promise<string> {
  const claimWords = distinctiveWords(`${claim.title} ${claim.content}`);
  const allowed = entity ? distinctiveWords(entity.name) : new Set<string>();
  const copied = (question: string) => [...distinctiveWords(question)].filter(word => claimWords.has(word) && !allowed.has(word));
  const first = await askQuestion(userPrompt(claim, entity));
  const words = copied(first);
  const vague = !entity && /\b(our|we|us)\b/i.test(first);
  if (words.length <= 1 && !vague) return first;
  const problems = [
    ...(words.length > 1 ? [`It copies these words from the claim: ${words.join(", ")}. Rephrase without them.`] : []),
    ...(vague ? [`It says "our" or "we", but the knowledge base covers several companies. Name the company, organization or program the claim is about instead.`] : []),
  ];
  return askQuestion(`${userPrompt(claim, entity)}\n\nA first try was: ${first}\n${problems.join("\n")}`);
}

// =====================================================================
// MAIN
// =====================================================================

const { claims, entities } = await loadClaims();
const random = seededRandom(SEED);
const usable = claims.filter(claim => claim.content.length >= MIN_CONTENT_CHARS);
console.log(`Live claims with a title: ${claims.length}; long enough: ${usable.length}`);

// Pick claims in spread order, skipping any that duplicates or is duplicated by one already picked
const picked: { claim: Claim; candidates: { unitId: string; content: string }[] }[] = [];
const covered = new Set<string>();
for (const claim of spreadOrder(usable, random)) {
  if (picked.length >= TARGET) break;
  if (covered.has(claim.unitId)) continue;
  const duplicates = await nearDuplicates(claim);
  if (duplicates.some(duplicate => covered.has(duplicate.unitId))) continue;
  picked.push({ claim, candidates: duplicates });
  for (const id of [claim.unitId, ...duplicates.map(duplicate => duplicate.unitId)]) covered.add(id);
}

// Harder questions: claims whose topic belongs to an entity and that chat's entity scope reaches
const scopes = new Map<string, Set<string>>();
const entityFor = new Map<string, Entity>();
for (const { claim, candidates } of shuffle(picked, random)) {
  if (entityFor.size >= ENTITY_TARGET) break;
  const entityId = claim.contextEntityIds[0];
  const entity = entityId ? entities.get(entityId) : undefined;
  if (!entity) continue;
  if (!scopes.has(entity.id)) scopes.set(entity.id, await entityScope(entity));
  if ([claim.unitId, ...candidates.map(candidate => candidate.unitId)].every(id => scopes.get(entity.id)!.has(id))) entityFor.set(claim.unitId, entity);
}

const questions: Question[] = [];
for (const [index, { claim, candidates }] of picked.entries()) {
  const entity = entityFor.get(claim.unitId) ?? null;
  const question = await writeQuestion(claim, entity);
  const unitIds = [claim.unitId];
  for (const candidate of candidates) if (await sameAnswer(question, claim, candidate.content)) unitIds.push(candidate.unitId);
  const id =`q${String(index + 1).padStart(2, "0")}`;
  questions.push({ id, question, unitIds, entityId: entity?.id ?? null, claimTitle: claim.title });
  console.log(`${id} [${claim.kind}${entity ? `, ${entity.name}` : ""}] ${claim.title} (${unitIds.length} of ${candidates.length + 1} similar units kept)\n    ${question}`);
}

writeFileSync(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`);
console.log(`Wrote ${questions.length} questions (${entityFor.size} with an entity, ${questions.filter(q => q.unitIds.length > 1).length} with near-duplicates) to ${OUTPUT}`);
