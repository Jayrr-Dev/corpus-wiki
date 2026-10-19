import {targetFromEnvironment} from '../scripts/db/targets.ts';
const timeout=setTimeout(()=>{console.log('Direct database connection timed out after 20 seconds.');process.exit(2);},20000);
let db;
try{db=await targetFromEnvironment({...process.env,SUPABASE_ACCESS_TOKEN:''});
console.log(JSON.stringify(await db.query(`select now() checked_at, count(*) sessions from pg_stat_activity`)));
}catch(e){console.log(e.message);process.exitCode=1;}finally{clearTimeout(timeout);await db?.close();}
