import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{console.log(JSON.stringify(await db.query(`select indexname,indexdef from pg_indexes where schemaname='public' and tablename='glossary_embeddings'`)));console.log(JSON.stringify(await db.query(`select pg_get_functiondef('public.save_glossary_embeddings(jsonb)'::regprocedure) definition`)));}finally{await db.close();}
