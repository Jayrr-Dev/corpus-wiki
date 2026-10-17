import {targetFromEnvironment} from './db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 console.log(JSON.stringify(await db.query(`select d.path, count(*) count,
 jsonb_agg(jsonb_build_object('id',u.id,'text',r.content) order by u.id) claims
 from domains d join unit_domains ud on ud.domain_id=d.id
 join units u on u.id=ud.unit_id and u.retired_at is null
 join revisions r on r.id=u.current_revision_id
 where d.retired_at is null and exists(select 1 from domains child where child.parent_id=d.id and child.retired_at is null)
 group by d.path order by count(*) desc,d.path`),null,2));
} finally {await db.close();}
