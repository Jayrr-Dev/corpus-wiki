import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
 const rows=await db.query(`select proposal->>'title' title,jsonb_array_length(proposal->'claimIds') claims,reason,proposal->'outlineReview'->'attempts' attempts from article_reviews where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and proposal ? 'outlineReview' order by created_at`);
 for(const row of rows){const last=row.attempts.at(-1);console.log(JSON.stringify({title:row.title,claims:row.claims,attempts:row.attempts.length,bestScore:Math.max(...row.attempts.map(a=>a.review?['grounding','cohesion','flow','headings','balance','introduction'].reduce((sum,key)=>sum+a.review[key].score,0):0)),lastPlan:last.plan,lastReview:last.review,structural:last.problems}));}
}finally{await db.close();}
