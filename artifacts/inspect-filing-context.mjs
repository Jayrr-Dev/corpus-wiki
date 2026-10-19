import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {writeFile} from 'node:fs/promises';
const db=await targetFromEnvironment(process.env);
try {
 const result=await db.query(`with scope as materialized(select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true)) select public.upload_topic_context('811105ea-fcfe-4ac4-9c7d-dc589b1501e4') as context from scope`);
 const context=result[0].context;
 console.log(JSON.stringify({parts:Object.fromEntries(Object.entries(context).map(([key,value])=>[key,{characters:JSON.stringify(value).length,count:Array.isArray(value)?value.length:null}]))}));
 await writeFile('artifacts/current-filing-context.json',JSON.stringify(context));
}finally{await db.close();}
