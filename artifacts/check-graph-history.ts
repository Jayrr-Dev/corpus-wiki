import { targetFromEnvironment } from "../scripts/db/targets.ts";
import { writeFileSync, readFileSync } from "node:fs";
const db = await targetFromEnvironment(process.env);
try {
  const rows = await db.query(`select jsonb_build_object(
    'domains',(select jsonb_agg(jsonb_build_array(id,name,path,parent_id,retired_at is not null) order by id) from domains),
    'memberships',(select jsonb_agg(jsonb_build_array(unit_id,domain_id) order by unit_id,domain_id) from unit_domains),
    'claims',(select jsonb_agg(jsonb_build_array(u.id,u.current_revision_id,u.retired_at,r.content) order by u.id) from units u join revisions r on r.id=u.current_revision_id),
    'links',(select jsonb_agg(jsonb_build_array(id,from_unit_id,to_unit_id,type) order by id) from relationships where retired_at is null)
  ) as state,public.graph_edit_history()->'undo' as undo`);
  const state = JSON.stringify(rows[0]?.state);
  if (process.argv.includes("--save")) {
    writeFileSync("artifacts/graph-history-live-baseline.json",state);
    console.log("Saved baseline.", JSON.stringify(rows[0]?.undo));
  } else {
    if(state!==readFileSync("artifacts/graph-history-live-baseline.json","utf8")) {
      const before=JSON.parse(readFileSync("artifacts/graph-history-live-baseline.json","utf8")); const after=JSON.parse(state);
      for(const key of Object.keys(before)) if(JSON.stringify(before[key])!==JSON.stringify(after[key])) console.log(key,JSON.stringify({missing:before[key].filter((r:unknown)=>!after[key].some((v:unknown)=>JSON.stringify(v)===JSON.stringify(r))),added:after[key].filter((r:unknown)=>!before[key].some((v:unknown)=>JSON.stringify(v)===JSON.stringify(r)))}));
      throw new Error("Graph differs from baseline");
    }
    console.log("PASS: all domain identities, memberships, claim text/revisions and active links match baseline.");
  }
} finally { await db.close(); }
