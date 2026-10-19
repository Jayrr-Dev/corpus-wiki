import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
console.log(JSON.stringify(await db.query(`begin;
select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
with evidence as (
 select u.id,r.passage_ids from units u join revisions r on r.id=u.current_revision_id
 where u.space_id='21132c80-32b3-4ef2-9156-d9af60486173' and u.retired_at is null
 and exists(select 1 from passages p where p.id=any(r.passage_ids) and p.source_id='4d1ebe80-779e-4c7f-9e30-80a47c8af886')
), linked as (
 select distinct s.page_id from sections s join section_inputs si on si.section_id=s.id
 join evidence e on e.id=si.unit_id where s.retired_at is null
), live as(select s.* from sections s join linked p on p.page_id=s.page_id where s.retired_at is null)
select jsonb_build_object(
 'workflow',(select jsonb_build_object('state',state,'error',error,'cancelled',cancel_requested) from upload_workflows where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'),
 'original_sections',(select jsonb_build_object('saved_checkpoints',count(*),'missing_saved_sections',count(*) filter(where not exists(select 1 from sections s where s.id=right(step.key,36)::uuid))) from upload_steps step where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like 'rebuild-section:%' and state='succeeded'),
 'stages',(select jsonb_agg(jsonb_build_object('key',key,'state',state,'error',error)) from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key in('pages','articles-ready','describe','profiles','expand','embeddings-enrichment','hierarchy-enrichment','plan-enrichment','pages-enrichment','glossary','curate')),
 'knowledge',(select jsonb_build_object('units',count(*),'passage_refs',sum(cardinality(passage_ids)),'invalid',count(*) filter(where cardinality(passage_ids)=0 or exists(select 1 from unnest(passage_ids) id where not exists(select 1 from passages p where p.id=id)))) from evidence),
 'articles',(select jsonb_agg(jsonb_build_object('title',p.title,'sections',(select count(*) from live s where s.page_id=p.id),'lines',(select count(*) from section_lines l join live s on s.id=l.section_id where s.page_id=p.id and trim(l.content)<>''))) from pages p join linked x on x.page_id=p.id where p.retired_at is null),
 'section_status',(select jsonb_object_agg(status,n) from(select status,count(*) n from live group by status) counts),
 'unfinished_sections',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status)),'[]'::jsonb) from live where status<>'current'),
 'pending_article_reviews',public.pages_needing_editorial_review(array(select id from live)),
 'invalid_line_citations',(select count(*) from section_lines l join live s on s.id=l.section_id where exists(select 1 from unnest(l.unit_revision_ids) id where not exists(select 1 from revisions r where r.id=id)))
) audit;
commit;`)));
}finally{await db.close();}
