import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {compactPreviousPlacements} from '../lib/domains/filingEvidence.ts';
const db=await targetFromEnvironment(process.env);
try {
 const rows=await db.query(`select output->'placements' as placements from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and state='succeeded' and key like 'place-v4:3edfa30ae09375dd4ee5d557:review-v2:%' and output ? 'placements' order by updated_at`);
 const placed=new Map(rows.flatMap(row=>row.placements));
 const input=[...placed].map(([id,domainPaths],index)=>({ref:'C'+(index+1),domainPaths}));
 const before=JSON.stringify({previousPlacements:input}).length,after=JSON.stringify(compactPreviousPlacements(input)).length;
 console.log(JSON.stringify({claims:input.length,charactersBefore:before,charactersAfter:after,reductionPercent:Math.round(100*(1-after/before))}));
}finally{await db.close();}
