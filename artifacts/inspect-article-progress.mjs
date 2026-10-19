import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 console.log('book calls',JSON.stringify(await db.query(`select created_at,purpose,model,duration_ms,status,left(error,200) error from ai_calls where space_id='21132c80-32b3-4ef2-9156-d9af60486173' and created_at>now()-interval '15 minutes' order by created_at desc limit 15`)));
 console.log('settings',JSON.stringify(await db.query(`select to_jsonb(w)-'space_id' as settings from workspace_settings w where space_id='21132c80-32b3-4ef2-9156-d9af60486173'`)));
}finally{await db.close();}
