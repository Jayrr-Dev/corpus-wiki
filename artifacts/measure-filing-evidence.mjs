import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {createServer} from 'vite';
import {resolve} from 'node:path';
const db=await targetFromEnvironment(process.env);
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try {
 const evidence=await db.query(`with selected as (select u.id,r.passage_ids from (select output from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and state='succeeded' and key like 'place-v4:%:review-v2:%' and output ? 'placements' and jsonb_array_length(output->'placements')>40 order by updated_at desc limit 1) s cross join lateral jsonb_array_elements(s.output->'placements') q join units u on u.id=(q->>0)::uuid join revisions r on r.id=u.current_revision_id) select id as ref,coalesce((select jsonb_agg(jsonb_build_object('location',p.location,'text',p.text)) from passages p where p.id=any(s.passage_ids)),'[]') as passages from selected s`);
 const context={sourceEvidence:evidence};
 const {compactFilingEvidence}=await runtime.ssrLoadModule('/lib/domains/filingEvidence.ts');
 const compact=compactFilingEvidence(context);
 const before=JSON.stringify(context).length,after=JSON.stringify(compact).length;
 console.log(JSON.stringify({claims:evidence.length,passageCopies:evidence.reduce((n,c)=>n+c.passages.length,0),uniquePassages:compact.sourcePassages.length,charactersBefore:before,charactersAfter:after,reductionPercent:Math.round(100*(1-after/before))}));
} finally {await runtime.close();await db.close();}

