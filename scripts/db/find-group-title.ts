import { clusterCircles } from "../../lib/graph/clusters.ts";
import type { GraphNode } from "../../lib/graph/types.ts";
import { connectPostgres } from "./targets.ts";

const db = await connectPostgres(process.env.SUPABASE_DB_URL ?? "");
const units = await db.query<{
  id: string;
  title: string;
  degree: number;
  external: boolean;
}>(`
  select u.id::text,
         r.title,
         (
           (select count(*) from relationships rel where rel.retired_at is null and (rel.from_unit_id = u.id or rel.to_unit_id = u.id))
           + (select count(*) from unit_entities ue where ue.unit_id = u.id)
           + (select count(*) from unit_domains ud where ud.unit_id = u.id)
         )::int as degree,
         exists (
           select 1 from source_units su
           join sources s on s.id = su.source_id
           where su.unit_id = u.id and s.origin = 'external'
         ) as external
  from units u
  join revisions r on r.id = u.current_revision_id
  where not exists (select 1 from section_inputs si where si.unit_id = u.id)
`);
const links = await db.query<{ source: string; target: string }>(`
  select rel.from_unit_id::text as source, rel.to_unit_id::text as target
  from relationships rel
  where rel.retired_at is null
    and rel.from_unit_id in (select id from units u where not exists (select 1 from section_inputs si where si.unit_id = u.id))
    and rel.to_unit_id in (select id from units u where not exists (select 1 from section_inputs si where si.unit_id = u.id))
`);
const nodes = units.map((unit) => ({
  id: unit.id,
  kind: "unit" as const,
  label: unit.title,
  text: unit.title,
  href: "",
  createdAt: "",
  degree: unit.degree,
  domainPaths: [],
  entityNames: [],
  pageTitles: [],
  sourceScopes: unit.external ? (["external"] as const) : (["internal"] as const),
  unitKind: null,
  status: null,
})) satisfies GraphNode[];
const circles = clusterCircles(nodes, 1, "page", links);
const wanted = new Set([
  "Type Three acceptance guides balance",
  "Energy levels of Sevens and Nines",
  "Parents shape personality, not type",
  "Type Seven frustration pattern",
  "Nine deterioration: passivity and depression",
  "Type Seven nine-level sequence",
]);
const byId = new Map(nodes.map((node) => [node.id, node.label]));
const homes = new Map<string, string>();
for (const circle of circles) {
  if (circle.parent !== "No article") continue;
}
const { packDomains } = await import("../../lib/graph/clusters.ts");
const packed = packDomains(nodes, 1, "page", links);
for (const [id, home] of packed.homes) {
  const label = byId.get(id);
  if (!label || !wanted.has(label)) continue;
  const circle = packed.circles.find(
    (item) =>
      Math.hypot(item.x - home.x, item.y - home.y) < 1 &&
      item.parent === "No article",
  );
  homes.set(label, circle?.label ?? "?");
}
console.log(JSON.stringify({ homes: [...homes], circleCount: circles.length }, null, 2));
await db.close();
