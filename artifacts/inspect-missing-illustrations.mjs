import { targetFromEnvironment } from '../scripts/db/targets.ts';
const db = await targetFromEnvironment(process.env);
try {
  console.log(JSON.stringify(await db.query(`select p.id,p.slug,p.title,r.id as run_id,r.active,r.created_at,
    jsonb_array_length((r.composition::text)::jsonb->'figures') as figures
    from pages p left join composer_runs r on r.page_id=p.id where p.title ilike '%utilitek%' order by r.created_at desc`)));
  console.log(JSON.stringify(await db.query(`select j.page_id,j.outcome,j.finished_at from composer_jobs j join pages p on p.id=j.page_id where p.title ilike '%utilitek%'`)));
  console.log(JSON.stringify(await db.query(`select p.id, public.read_composer_run(p.id) is not null as current,
    public.read_composer_reusable_run(p.id)->'composition'->'figures' as reusable,
    (select (r.composition::text)::jsonb->'figures' from composer_runs r where r.page_id=p.id and r.active) as saved
    from pages p where p.slug='utilitek-solutions-inc-2'`)));
} finally { await db.close(); }

