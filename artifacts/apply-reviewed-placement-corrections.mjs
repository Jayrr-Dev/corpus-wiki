import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
const space='21132c80-32b3-4ef2-9156-d9af60486173';
const changes=[
 ['29e3ca13-9b47-4483-a011-ef0ccca106f1','Five','Stress and integration','Type Five growth toward Eight belongs beside its own stress direction, as requested in the filing review.'],
 ['9756e143-e17a-422b-aadc-5d73eaf5654d','Five','Stress and integration','Type Five acting out Eight behaviors is a type-specific direction pattern.'],
 ['faf7359f-0ea8-40b1-b95f-45cd37092326','Five','Basic motivations','Use the existing motivations subdivision for Type Five defense mechanisms, as requested in the filing review.'],
 ['b9a662dc-64a5-46cd-8a7c-06d927cdfa92','Four','Stress and integration','Keep Type Four integration beside its own disintegration pattern, rather than splitting its directions into the general definitions topic.'],
 ['c17363e1-3f73-4502-af24-46789d4f81c9','Four','Stress and integration','Keep the Type Four security-point example with the same type-specific directions.'],
];
try{
const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
if(actor.space_id!==space)throw Error('Wrong space');
const units=await db.query(`select u.id,u.current_revision_id,r.passage_ids from units u join revisions r on r.id=u.current_revision_id where u.space_id='${space}' and u.retired_at is null and u.id in (${changes.map(([id])=>quoteLiteral(id)).join(',')})`);
if(units.length!==changes.length)throw Error('A reviewed claim is unavailable');
const base={expectedRevisionId:null,passageIds:[],speechAct:null};
const actions=[
 {...base,type:'update_domain',targetId:'b31da82a-ebb8-4cc3-9c9b-810bf42a064d',input:{name:'Stress and integration'}},
 {...base,type:'update_domain',targetId:'e4611ac3-3de9-4c76-bbd9-e5c3e85f6132',input:{name:'Stress and integration'}},
 ...changes.map(([id,type,child,rationale])=>{const u=units.find(u=>u.id===id);return {...base,type:'place_claim',targetId:id,expectedRevisionId:u.current_revision_id,passageIds:u.passage_ids,input:{domainPaths:[`Enneagram/Type descriptions/Type ${type}/${child}`],rationale}};})
];
const headers=quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':space,'x-via':'script'}));
const rows=await db.query(`begin;set local statement_timeout='30s';select set_config('request.headers',${headers},true);set local role space_runtime;
create temp table correction_result(result jsonb) on commit drop;
do $correction$ declare proposal jsonb;result jsonb;begin
if exists(select 1 from sections where retired_at is null and (query::text like '%Enneagram/Type descriptions/Type Five/Stress and unhealthy patterns%' or query::text like '%Enneagram/Type descriptions/Type Four/Stress and unhealthy patterns%')) then raise exception 'A section filter needs migration before this rename';end if;
proposal:=public.submit_change_set(p_event_id=>null,p_cause=>'edit',p_actor=>'person',p_summary=>'Apply reviewed Type Four and Type Five filing corrections',p_trace=>'{}'::jsonb,p_actions=>${quoteLiteral(JSON.stringify(actions))}::jsonb);
result:=public.commit_change_set((proposal->>'changeSetId')::uuid);
if result->>'status'<>'applied' or (result->>'applied')::int<>7 or coalesce((result->>'exceptions')::int,0)<>0 then raise exception 'Corrections did not all pass change control: %',result;end if;
insert into correction_result values(result||jsonb_build_object('eventId',proposal->>'eventId'));
end $correction$;
select result from correction_result;${process.argv.includes('--apply')?'commit':'rollback'};`);
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'applied':'rolled-back preview',result:rows}));
}finally{await db.close();}
