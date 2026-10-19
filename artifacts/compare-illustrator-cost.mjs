import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const {data,error}=await db.from('ai_calls').select('created_at,purpose,model,prompt_tokens,completion_tokens,status,duration_ms').gte('created_at','2026-10-17T16:47:43Z').like('purpose','%compos%').order('created_at');
if(error)throw error;
const groups={ppeBefore:data.filter(r=>r.created_at<'2026-10-17T16:48:38Z'),noiseBefore:data.filter(r=>r.created_at>='2026-10-17T16:48:38Z'&&r.created_at<'2026-10-17T16:50:00Z'),optimizedRuns:data.filter(r=>r.created_at>='2026-10-17T16:58:12Z')};
for(const rows of Object.values(groups))for(const row of rows)row.estimatedCost=(row.prompt_tokens*4+row.completion_tokens*20)/1e6;
await writeFile('artifacts/composer-live/cost-comparison.json',JSON.stringify(groups,null,2));
console.log(JSON.stringify(groups,null,2));
