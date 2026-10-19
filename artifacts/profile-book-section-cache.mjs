import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
const [{section}]=await db.query(`select section_id section from lines where space_id='21132c80-32b3-4ef2-9156-d9af60486173' and retired_at is null group by section_id order by count(*) desc limit 1`);console.log({section});
const base=`from public.lines l join public.line_revisions lr on lr.id=l.current_revision_id`;
const old=`select distinct on(r.unit_id) r.unit_id,r.id ${base} join public.revisions r on r.id=any(lr.unit_revision_ids) where l.section_id='${section}' and l.retired_at is null order by r.unit_id,r.created_at desc`;
const narrow=`with cited as materialized(select distinct unnest(lr.unit_revision_ids) id ${base} where l.section_id='${section}' and l.retired_at is null) select distinct on(r.unit_id) r.unit_id,r.id from cited c join public.revisions r on r.id=c.id order by r.unit_id,r.created_at desc`;
const scope=`select set_config('request.headers',jsonb_build_object('x-person-id',person_id,'x-space-id',space_id)::text,true) from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'; set local role space_runtime;`;
try{for(const [name,q] of [['old',old],['narrow',narrow]]){
 const data=await db.query(`begin;set local statement_timeout='25s';${scope} explain(analyze,buffers,format json) ${q};rollback;`);
 const plan=data[0]?.['QUERY PLAN']?.[0];
 function nodes(p){return [{type:p['Node Type'],relation:p['Relation Name'],index:p['Index Name'],rows:p['Actual Rows'],loops:p['Actual Loops']},...(p.Plans??[]).flatMap(nodes)];}
 console.log(JSON.stringify({name,ms:plan?.['Execution Time'],temp:plan?.Plan?.['Temp Written Blocks'],nodes:plan?nodes(plan.Plan):data}));
}
console.log('difference',JSON.stringify(await db.query(`begin;${scope} with old as (${old}), narrow as (${narrow}) select count(*) changed from ((select * from old except select * from narrow) union all (select * from narrow except select * from old)) d;rollback;`)));
}finally{await db.close();}

