import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);const space='21132c80-32b3-4ef2-9156-d9af60486173';
try{
console.log('articles',JSON.stringify(await db.query(`select p.id,p.title,count(s.id)::int sections,count(*) filter(where s.status='current')::int current_sections,count(*) filter(where s.status='current' and length(trim(s.body))=0)::int empty_current,sum(length(s.body))::int characters from pages p join sections s on s.page_id=p.id and s.retired_at is null where p.space_id='${space}' and p.retired_at is null group by p.id,p.title order by current_sections desc,p.title`)));
console.log('sample',JSON.stringify(await db.query(`select p.title article,s.title section,s.body from pages p join sections s on s.page_id=p.id and s.retired_at is null where p.id='168ce95b-a553-4ed4-ad70-22cd3bcbc13a' and s.status='current' and length(s.body)>0 order by s.position limit 6`)));
}finally{await db.close();}
