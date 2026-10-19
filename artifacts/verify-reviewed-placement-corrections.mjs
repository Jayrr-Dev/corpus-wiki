import {targetFromEnvironment} from '../scripts/db/targets.ts';const db=await targetFromEnvironment(process.env);
const expected=new Map([
 ['29e3ca13-9b47-4483-a011-ef0ccca106f1','Enneagram/Type descriptions/Type Five/Stress and integration'],
 ['9756e143-e17a-422b-aadc-5d73eaf5654d','Enneagram/Type descriptions/Type Five/Stress and integration'],
 ['faf7359f-0ea8-40b1-b95f-45cd37092326','Enneagram/Type descriptions/Type Five/Basic motivations'],
 ['b9a662dc-64a5-46cd-8a7c-06d927cdfa92','Enneagram/Type descriptions/Type Four/Stress and integration'],
 ['c17363e1-3f73-4502-af24-46789d4f81c9','Enneagram/Type descriptions/Type Four/Stress and integration'],
 ['f915ad6d-5cb3-464f-bebc-8605bccafa97','Enneagram/Type descriptions/Type Four'],
 ['680be65b-a533-450e-8727-e2f542ee7966','Enneagram/Type descriptions/Type Five/Basic motivations'],
]);
try{
const rows=await db.query(`select u.id,array(select d.path from unit_domains m join domains d on d.id=m.domain_id where m.unit_id=u.id and d.retired_at is null order by d.path) paths from units u where u.space_id='21132c80-32b3-4ef2-9156-d9af60486173' and u.id in (${[...expected.keys()].map(id=>`'${id}'`).join(',')})`);
const mismatches=rows.filter(r=>r.paths.length!==1||r.paths[0]!==expected.get(r.id));
console.log(JSON.stringify({checked:rows.length,mismatches,audit:await db.query(`select outcome,count(*)::int actions from actions where change_set_id='656f3a1b-ea88-4187-a4be-22488e5fd0cc' group by outcome`)}));
if(rows.length!==expected.size||mismatches.length)throw Error('Reviewed placements differ from the requested corrections');
}finally{await db.close();}
