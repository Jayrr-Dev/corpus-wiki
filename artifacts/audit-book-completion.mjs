import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4',source='4d1ebe80-779e-4c7f-9e30-80a47c8af886',space='21132c80-32b3-4ef2-9156-d9af60486173';
const required=['reconciliation-input','extraction','reconcile','embeddings','duplicates','tidy','embeddings-cleaned','place','hierarchy','plan','pages','articles-ready','describe','profiles','expand','embeddings-enrichment','hierarchy-enrichment','plan-enrichment','pages-enrichment','glossary','curate'];
try {
 const [workflow]=await db.query(`select state,error,cancel_requested,progress from upload_workflows where event_id='${event}'`);
 const stages=await db.query(`select key,state,error from upload_steps where event_id='${event}' and key in (${required.map(key=>"'"+key+"'").join(',')}) order by key`);
 const unfinished=required.filter(key=>!stages.some(stage=>stage.key===key&&stage.state==='succeeded'));
 const [actor]=await db.query(`select person_id,space_id from shift_events where id='${event}'`);
 if(actor.space_id!==space)throw Error('Unexpected completion audit workspace');
 const [metrics]=await db.query(`begin;
 select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':space,'x-via':'script'}))},true);
 with eligible as materialized(
  select distinct u.id,u.current_revision_id from public.units u join public.actions a on a.target_id=u.id join public.change_sets c on c.id=a.change_set_id
  where c.event_id='${event}' and a.type::text in ('add_claim','revise_claim') and a.outcome='applied' and u.retired_at is null
 ), live_pages as materialized(
  select distinct p.id from eligible e join public.section_inputs si on si.unit_id=e.id join public.sections s on s.id=si.section_id join public.pages p on p.id=s.page_id
  where s.retired_at is null and p.retired_at is null
  union
  select distinct p.id from public.pages p join public.actions a on a.target_id=p.id join public.change_sets c on c.id=a.change_set_id
  where c.event_id='${event}' and a.type::text='create_page' and a.outcome='applied' and p.retired_at is null
 ) select
  (select count(*)::int from eligible) live_claims,
  (select count(*)::int from eligible e where not exists(select 1 from public.unit_domains m join public.domains d on d.id=m.domain_id where m.unit_id=e.id and d.retired_at is null)) unfiled_claims,
  (select count(distinct d.id)::int from eligible e join public.unit_domains m on m.unit_id=e.id join public.domains d on d.id=m.domain_id where d.retired_at is null) domains,
  (select count(*)::int from eligible e join public.revisions r on r.id=e.current_revision_id where cardinality(r.passage_ids)=0 or exists(select 1 from unnest(r.passage_ids) ref where not exists(select 1 from public.passages p where p.id=ref))) invalid_claim_citations,
  (select count(*)::int from live_pages) articles,
  (select count(*)::int from public.sections s join live_pages p on p.id=s.page_id where s.retired_at is null and s.mode='generated' and s.status<>'current') unfinished_sections,
  (select count(*)::int from public.sections s join live_pages p on p.id=s.page_id where s.retired_at is null and s.mode='generated' and nullif(btrim(s.body),'') is null) empty_generated_sections,
  (select count(*)::int from live_pages p where public.page_review_content_hash(p.id) is distinct from (select r.snapshot_hash from public.page_review_runs r where r.page_id=p.id order by r.created_at desc limit 1)) unreviewed_articles,
  (select count(*)::int from public.lines l join public.sections s on s.id=l.section_id join live_pages p on p.id=s.page_id where l.retired_at is null and s.retired_at is null) article_lines,
  (select count(*)::int from public.lines l join public.sections s on s.id=l.section_id join live_pages p on p.id=s.page_id join public.line_revisions r on r.id=l.current_revision_id where l.retired_at is null and s.retired_at is null and (cardinality(r.unit_revision_ids)=0 or exists(select 1 from unnest(r.unit_revision_ids) ref where not exists(select 1 from public.revisions ur where ur.id=ref)))) invalid_line_citations,
  (select jsonb_array_length(entries) from public.glossary_state where space_id='${space}') dictionary_entries,
  (select count(*)::int from public.entities where space_id='${space}' and merged_into_id is null and retired_at is null and nullif(btrim(description),'') is not null) described_entities,
  (select count(*)::int from public.exceptions x join public.actions a on a.id=x.action_id join public.change_sets c on c.id=a.change_set_id
   where x.status='open' and (c.event_id='${event}' or a.target_id in(select id from eligible union select id from live_pages union select s.id from public.sections s join live_pages p on p.id=s.page_id)
    or a.input->>'pageId' in(select id::text from live_pages))) open_exceptions;rollback;`);
 const complete=workflow?.state==='complete'&&!workflow.error&&!workflow.cancel_requested&&unfinished.length===0&&metrics.live_claims>=1843&&metrics.unfiled_claims===0&&metrics.domains>0&&metrics.articles>0&&metrics.article_lines>0&&metrics.dictionary_entries>0&&metrics.described_entities>0&&metrics.unfinished_sections===0&&metrics.empty_generated_sections===0&&metrics.unreviewed_articles===0&&metrics.invalid_claim_citations===0&&metrics.invalid_line_citations===0&&metrics.open_exceptions===0;
 console.log(JSON.stringify({complete,workflow,unfinishedStages:unfinished,failedStages:stages.filter(stage=>stage.state==='failed'),metrics},null,2));
 if(process.argv.includes('--require-complete')&&!complete)throw Error('The complete upload outcome is not yet proven.');
}finally{await db.close();}
