import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { targetFromEnvironment } from "./db/targets.ts";
import type { Tables } from "../lib/database/types.ts";

// Restore the previously approved organization branch, keeping reference cleanup.
// The input is the snapshot written by clean-domains.ts. Dry run unless --apply.
type State = { domains: Tables<"domains">[]; pages: Tables<"pages">[]; sections: Tables<"sections">[]; unitDomains: Tables<"unit_domains">[]; units: number; revisions: number; evidenceLinks: number };
const backup = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { before: State };
const originals = backup.before.domains.filter((row) => row.path === "Utilitek Solutions Inc." || row.path.startsWith("Utilitek Solutions Inc./"));
const root = originals.find((row) => row.path === "Utilitek Solutions Inc.")!;
const safety = originals.find((row) => row.path === "Utilitek Solutions Inc./Health & Safety")!;
if (!root?.context_entity_id || !safety) throw new Error("Snapshot does not contain the expected organization branch.");
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
const snapshot = `jsonb_build_object(
 'domains',(select jsonb_agg(to_jsonb(d) order by id) from public.domains d),
 'pages',(select jsonb_agg(to_jsonb(p) order by id) from public.pages p),
 'sections',(select jsonb_agg(to_jsonb(s) order by id) from public.sections s),
 'unitDomains',(select jsonb_agg(to_jsonb(u) order by unit_id,domain_id) from public.unit_domains u),
 'units',(select count(*) from public.units),'revisions',(select count(*) from public.revisions),
 'evidenceLinks',(select count(*) from public.source_units))`;
const target = await targetFromEnvironment(process.env);
try {
  const rows = await target.query<{ state: State }>(`select ${snapshot} as state`);
  const before = rows[0]!.state;
  const oldPrefix = "Health & Safety/Utilitek Solutions Inc.";
  const remapPath = (path: string) => path === oldPrefix || path.startsWith(`${oldPrefix}/`) ? safety.path + path.slice(oldPrefix.length) : path;
  console.log(JSON.stringify({ organizationRoot: root.path, topicBranch: safety.path, restoredDomains: originals.length, referenceRoots: ["Health & Safety", "Quality Management", "Training"] }));
  if (process.argv.includes("--apply")) {
    const directory = join(import.meta.dirname, "..", "artifacts");
    mkdirSync(directory, { recursive: true });
    const backupPath = join(directory, `organization-domain-restore-${Date.now()}.json`);
    writeFileSync(backupPath, JSON.stringify({ before }, null, 2));
    const sql = ["begin;", "lock table public.domains,public.unit_domains,public.pages,public.sections in share row exclusive mode;",
      `do $verify$ begin if ${snapshot}<>${json(before)} then raise exception 'Workspace changed since preview'; end if; end $verify$;`];
    for (const domain of originals.sort((a, b) => a.path.length - b.path.length)) {
      sql.push(`update public.domains set name=${literal(domain.name)},path=${literal(domain.path)},parent_id=${domain.parent_id ? literal(domain.parent_id) : "null"},context_entity_id=${literal(root.context_entity_id)},retired_at=null where id=${literal(domain.id)};`);
    }
    // Only undo memberships that the earlier merge moved from the safety branch.
    for (const link of backup.before.unitDomains.filter((row) => row.domain_id === safety.id)) {
      sql.push(`insert into public.unit_domains(unit_id,domain_id) values(${literal(link.unit_id)},${literal(safety.id)}) on conflict do nothing;`);
      if (!backup.before.unitDomains.some((row) => row.unit_id === link.unit_id && row.domain_id === root.id)) sql.push(`delete from public.unit_domains where unit_id=${literal(link.unit_id)} and domain_id=${literal(root.id)};`);
    }
    for (const page of backup.before.pages.filter((row) => row.domain_id === safety.id)) sql.push(`update public.pages set domain_id=${literal(safety.id)} where id=${literal(page.id)} and domain_id=${literal(root.id)};`);
    for (const section of before.sections) {
      const query = section.query as { domainPaths?: string[] } | null;
      if (!query?.domainPaths?.some((path) => path === oldPrefix || path.startsWith(`${oldPrefix}/`))) continue;
      const original = backup.before.sections.find((row) => row.id === section.id)?.query as { domainPaths?: string[] } | undefined;
      const domainPaths = query.domainPaths.flatMap((path) => {
        if (path === oldPrefix && original?.domainPaths?.some((item) => item.startsWith(root.path))) return original.domainPaths.filter((item) => item.startsWith(root.path));
        return [remapPath(path)];
      });
      sql.push(`update public.sections set query=jsonb_set(query,'{domainPaths}',${json([...new Set(domainPaths)])}) where id=${literal(section.id)};`);
    }
    sql.push(`do $verify$ begin
      if (select count(*) from public.units)<>${before.units} or (select count(*) from public.revisions)<>${before.revisions} or (select count(*) from public.source_units)<>${before.evidenceLinks} then raise exception 'Evidence changed'; end if;
      if exists(select 1 from public.domains d left join public.domains p on p.id=d.parent_id where d.retired_at is null and d.parent_id is not null and (p.retired_at is not null or d.path<>p.path||'/'||d.name)) then raise exception 'Invalid domain hierarchy'; end if;
    end $verify$;`, `insert into public.hierarchy_changes(entity_id,before_state,after_state) values(${literal(root.context_entity_id)},${json(before)},${snapshot});`, "commit;");
    await target.query(sql.join("\n"));
    console.log(JSON.stringify({ applied: true, backupPath }));
  }
} finally { await target.close(); }
