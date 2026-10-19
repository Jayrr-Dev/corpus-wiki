import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
  console.log(JSON.stringify(await db.query(`select s.title,e.status,e.error,e.created_at from shift_events e join sources s on s.id=e.source_id where s.id in (select source_id from external_source_reviews where page_id=(select id from pages where slug='workplace-health-and-safety-regulation')) order by e.created_at desc limit 4`)));
  console.log(JSON.stringify(await db.query(`select p.id,p.title,p.slug,count(distinct s.id) as sections,count(distinct l.id) as paragraphs,
    coalesce(sum(array_length(regexp_split_to_array(trim(lr.content),'\\s+'),1)),0) as words
    from pages p left join sections s on s.page_id=p.id and s.retired_at is null
    left join lines l on l.section_id=s.id and l.retired_at is null left join line_revisions lr on lr.id=l.current_revision_id
    where p.slug='workplace-health-and-safety-regulation' group by p.id`)));
  console.log(JSON.stringify(await db.query(`select stage,outcome,reason,source_id,url,created_at from external_source_reviews
    where page_id=(select id from pages where slug='workplace-health-and-safety-regulation') order by created_at desc limit 6`)));
  console.log(JSON.stringify(await db.query(`select s.id,s.query, public.read_section_state(s.id) as state from sections s
    join pages p on p.id=s.page_id where p.slug='workplace-health-and-safety-regulation' and s.retired_at is null`)));
} finally {await db.close();}
