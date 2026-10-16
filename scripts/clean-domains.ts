import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { targetFromEnvironment } from "./db/targets.ts";
import type { Tables } from "../lib/database/types.ts";

// Reviewed consolidation of the current taxonomy. Dry run unless --apply is supplied.
// Originals are retained as retired rows; claim text and evidence are never changed.
const PREFIXES: [string, string][] = [
  ["WHMIS Course COR414", "Health & Safety/WHMIS/Training/COR414"],
  ["Government of Canada", "Training/Providers/Government of Canada"],
  ["DM&E/Quality Control", "Quality Management/Quality Control/Providers/DM&E"],
  ["DM&E", "Quality Management/Quality Control/Providers/DM&E"],
  ["Quality Management/Inspection", "Quality Management/Quality Control/Inspections"],
  ["Quality Control", "Quality Management/Quality Control"],
];
function destination(path: string): string {
  const prefix = PREFIXES.find(([from]) => path === from || path.startsWith(`${from}/`));
  let next = prefix ? prefix[1] + path.slice(prefix[0].length) : path;
  next = next.replace(/^Quality Management\/Quality Control\/(Inspection|Quality Inspection|Quality Inspections)(\/|$)/, "Quality Management/Quality Control/Inspections$2");
  next = next.replace("/Inspections/Pre-production Inspection", "/Inspections/Pre-Production Inspection");
  next = next.replace(/^Quality Management\/Quality Control\/Inspection Reports(\/|$)/, "Quality Management/Quality Control/Inspections/Reporting$1");
  next = next.replace(/^Quality Management\/Quality Control\/Inspection Reporting(\/|$)/, "Quality Management/Quality Control/Inspections/Reporting$1");
  if (next === "Health & Safety/WHMIS/Roles") next = "Health & Safety/WHMIS/Roles & Responsibilities";
  return next;
}

type Snapshot = {
  domains: Tables<"domains">[]; pages: Tables<"pages">[]; sections: Tables<"sections">[];
  unitDomains: Tables<"unit_domains">[]; exceptions: Tables<"exceptions">[];
  units: number; revisions: number; evidenceLinks: number;
};
const SNAPSHOT = `jsonb_build_object(
  'domains',(select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from public.domains d),
  'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.pages p),
  'sections',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.sections s),
  'unitDomains',(select coalesce(jsonb_agg(to_jsonb(u) order by unit_id,domain_id),'[]') from public.unit_domains u),
  'exceptions',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.exceptions x),
  'units',(select count(*) from public.units),'revisions',(select count(*) from public.revisions),
  'evidenceLinks',(select count(*) from public.source_units))`;
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;

const target = await targetFromEnvironment(process.env);
try {
  const rows = await target.query<{ snapshot: Snapshot }>(`select ${SNAPSHOT} as snapshot`);
  const before = rows[0]!.snapshot;
  const active = before.domains.filter((domain) => !domain.retired_at);
  const groups = new Map<string, Tables<"domains">[]>();
  for (const domain of active) {
    const path = destination(domain.path);
    groups.set(path, [...(groups.get(path) ?? []), domain]);
  }
  // New ancestors are subtopics of existing broad roots, never new roots.
  for (const path of [...groups.keys()]) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (!groups.has(parent)) groups.set(parent, []);
    }
  }
  const canonical = new Map([...groups].map(([path, domains]) => [path,
    domains.find((domain) => domain.path === path) ?? [...domains].sort((a, b) => a.path.length - b.path.length)[0],
  ]));
  const ids = new Map([...canonical].map(([path, domain]) => [path, domain?.id ?? randomUUID()]));
  const remap = new Map(active.map((domain) => [domain.id, ids.get(destination(domain.path))!]));
  const paths = new Map(active.map((domain) => [domain.path, destination(domain.path)]));
  const roots = [...groups.keys()].filter((path) => !path.includes("/"));
  if (roots.some((path) => !active.some((domain) => domain.path === path && !domain.parent_id))) throw new Error("Cleanup would introduce a new root.");
  const plan = {
    rootsBefore: active.filter((domain) => !domain.parent_id).map((domain) => domain.path), rootsAfter: roots.sort(),
    activeBefore: active.length, activeAfter: groups.size,
    merged: active.filter((domain) => remap.get(domain.id) !== domain.id).map((domain) => ({ from: domain.path, to: destination(domain.path) })),
    moves: active.filter((domain) => domain.path !== destination(domain.path)).map((domain) => ({ from: domain.path, to: destination(domain.path) })),
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!process.argv.includes("--apply")) process.exitCode = 0;
  else {
    const auditEntity = active.find((domain) => domain.path === "Utilitek Solutions Inc.")?.context_entity_id;
    if (!auditEntity) throw new Error("Expected context for recording the hierarchy audit was not found.");
    const directory = join(import.meta.dirname, "..", "artifacts");
    mkdirSync(directory, { recursive: true });
    const backupPath = join(directory, `domain-cleanup-${Date.now()}.json`);
    writeFileSync(backupPath, JSON.stringify({ before, plan }, null, 2));
    const statements: string[] = ["begin;", "lock table public.domains,public.unit_domains,public.pages,public.sections,public.exceptions in share row exclusive mode;",
      `do $verify$ begin if ${SNAPSHOT} <> ${json(before)} then raise exception 'Workspace changed since the cleanup preview; rerun it.'; end if; end $verify$;`];
    // Move keepers out of the way before assigning canonical paths.
    for (const [path, domain] of canonical) if (domain && domain.path !== path) statements.push(`update public.domains set path=${literal(`__cleanup__/${domain.id}`)} where id=${literal(domain.id)};`);
    for (const [path, domain] of [...canonical].sort((a, b) => a[0].split("/").length - b[0].split("/").length)) {
      const parent = path.includes("/") ? literal(ids.get(path.slice(0, path.lastIndexOf("/")))!) : "null";
      if (domain) statements.push(`update public.domains set name=${literal(path.split("/").at(-1))},path=${literal(path)},parent_id=${parent} where id=${literal(domain.id)};`);
      else statements.push(`insert into public.domains(id,name,path,parent_id,proposed_by) values(${literal(ids.get(path))},${literal(path.split("/").at(-1))},${literal(path)},${parent},'person');`);
    }
    for (const [from, to] of remap) if (from !== to) {
      statements.push(`insert into public.unit_domains(unit_id,domain_id) select unit_id,${literal(to)}::uuid from public.unit_domains where domain_id=${literal(from)} on conflict do nothing;`,
        `delete from public.unit_domains where domain_id=${literal(from)};`,
        `update public.pages set domain_id=${literal(to)} where domain_id=${literal(from)};`,
        `update public.exceptions set domain_id=${literal(to)} where domain_id=${literal(from)};`,
        `update public.domains set parent_id=${literal(to)} where parent_id=${literal(from)} and retired_at is not null;`,
        `update public.domains set retired_at=now(),parent_id=${literal(to)} where id=${literal(from)};`);
    }
    for (const section of before.sections) {
      const query = section.query as { domainPaths?: string[] } | null;
      if (!query?.domainPaths?.some((path) => paths.has(path) && paths.get(path) !== path)) continue;
      const domainPaths = [...new Set(query.domainPaths.map((path) => paths.get(path) ?? path))];
      statements.push(`update public.sections set query=jsonb_set(query,'{domainPaths}',${json(domainPaths)}) where id=${literal(section.id)};`);
    }
    const coveredUnits = [...new Set(before.unitDomains.map((row) => row.unit_id))].sort();
    statements.push(`do $verify$ begin
      if (select count(*) from public.units)<>${before.units} or (select count(*) from public.revisions)<>${before.revisions}
        or (select count(*) from public.source_units)<>${before.evidenceLinks} then raise exception 'Evidence counts changed'; end if;
      if (select coalesce(jsonb_agg(unit_id order by unit_id),'[]') from (select distinct unit_id from public.unit_domains) u)<>${json(coveredUnits)} then raise exception 'A claim lost domain coverage'; end if;
      if exists(select 1 from public.domains d left join public.domains p on p.id=d.parent_id where d.retired_at is null and d.parent_id is not null and (p.id is null or p.retired_at is not null or d.path<>p.path||'/'||d.name)) then raise exception 'Invalid hierarchy'; end if;
    end $verify$;`,
      `insert into public.hierarchy_changes(entity_id,before_state,after_state) values(${literal(auditEntity)},${json(before)},${SNAPSHOT});`, "commit;");
    await target.query(statements.join("\n"));
    console.log(JSON.stringify({ applied: true, backupPath, roots: roots.sort(), merged: plan.merged.length }));
  }
} finally { await target.close(); }
