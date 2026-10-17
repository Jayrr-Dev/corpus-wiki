import { targetFromEnvironment } from './db/targets.ts';
const t=await targetFromEnvironment(process.env);
try {
console.log(JSON.stringify(await t.query(`select u.id,r.title,r.content from public.unit_domains ud join public.domains d on d.id=ud.domain_id join public.units u on u.id=ud.unit_id join public.revisions r on r.id=u.current_revision_id where d.path='EPCOR/Utility Line Assignment' and u.retired_at is null order by u.id`)));
console.log(JSON.stringify(await t.query(`select r.from_unit_id,r.to_unit_id,r.type from public.relationships r where r.retired_at is null and (r.from_unit_id in (select ud.unit_id from public.unit_domains ud join public.domains d on d.id=ud.domain_id where d.path='EPCOR/Utility Line Assignment') or r.to_unit_id in (select ud.unit_id from public.unit_domains ud join public.domains d on d.id=ud.domain_id where d.path='EPCOR/Utility Line Assignment'))`)));
} finally {await t.close();}
