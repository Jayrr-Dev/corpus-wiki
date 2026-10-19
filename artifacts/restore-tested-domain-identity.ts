import { targetFromEnvironment } from "../scripts/db/targets.ts";
import { readFileSync } from "node:fs";
const baseline = JSON.parse(readFileSync("artifacts/graph-history-live-baseline.json","utf8"));
const original = baseline.domains.find((d: unknown[]) => d[2] === "Quality Management/Quality Control/Inspections/Inspection Methods");
if (!original || !/^[a-f0-9-]{36}$/.test(original[0])) throw new Error("Missing baseline domain");
const db = await targetFromEnvironment(process.env);
try {
  await db.query(`begin;
    do $$ declare h jsonb; edit_id uuid; begin
      h:=public.graph_edit_history(); edit_id:=(h->'undo'->>'id')::uuid;
      if edit_id is distinct from 'ad603a4d-e1af-41c6-886d-94926debe3d3'::uuid then raise exception 'History changed'; end if;
      perform public.step_graph_history(edit_id,'undo',h->>'fingerprint');
      update public.graph_redo_domains a set domains=
        (select jsonb_agg(case when d->>'path'='Quality Management/Quality Control/Inspections/Inspection Methods'
          then jsonb_set(d,'{id}',to_jsonb('${original[0]}'::text)) else d end)
          from jsonb_array_elements(a.domains) d) where action_id in(select a.id from public.actions a where change_set_id=edit_id);
      perform public.step_graph_history(edit_id,'redo',public.graph_edit_history()->>'fingerprint');
    end $$;
    commit;`);
  console.log("Restored the original domain ID using the saved pre-test baseline.");
} finally { await db.close(); }
