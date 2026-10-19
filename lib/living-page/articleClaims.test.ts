import { expect, it } from 'vitest';
import type { AdminSupabase } from '@/lib/supabase/admin';
import { loadArticleClaims } from './articleOrchestrator';
import { loadArticleKnowledge } from './articlePlanner';

function bookClient(failLate = false) {
 const units = Array.from({length:1103},(_,index)=>({id:`u${String(index).padStart(4,'0')}`,current_revision_id:`r${index}`,kind:'fact',epistemic_status:'supported'}));
 const tables:Record<string,Record<string,unknown>[]>={
  units,
  revisions:units.map((u,index)=>({id:u.current_revision_id,content:`Evidence ${index}`,knowledge_context:null})),
  unit_domains:units.flatMap(u=>Array.from({length:6},(_,index)=>({unit_id:u.id,domain_id:`d${u.id}-${index}`}))),
  unit_entities:units.flatMap(u=>Array.from({length:6},(_,index)=>({unit_id:u.id,entity_id:`e${u.id}-${index}`,role:'subject'}))),
 };
 tables.domains=tables.unit_domains!.map(row=>({id:row.domain_id,path:`Book/${row.domain_id}`}));
 tables.entities=tables.unit_entities!.map(row=>({id:row.entity_id,name:row.entity_id,type:'concept',key:row.entity_id}));
 tables.relationships=units.map((unit,index)=>({from_unit_id:unit.id,to_unit_id:units[index+1]?.id??'outside-article',type:'part_of'}));
 const reads:{table:string;from:number;filterSize:number}[]=[];
 const client={rpc:async()=>({data:units.map(unit=>unit.id),error:null}),from:(table:string)=>{
  let rows=[...tables[table]!],from=0,to=999,filterSize=0,single=false;
  const order:string[]=[];
  const query={
   select:()=>query,is:()=>query,
   eq:(column:string,value:unknown)=>{rows=rows.filter(row=>row[column]===value);return query;},
   single:()=>{single=true;return query;},
   in:(column:string,ids:string[])=>{expect(ids.length).toBeLessThanOrEqual(100);filterSize=ids.length;rows=rows.filter(row=>ids.includes(String(row[column])));return query;},
   neq:(column:string,value:unknown)=>{rows=rows.filter(row=>row[column]!==value);return query;},
   order:(column:string)=>{order.push(column);return query;},
   range:(start:number,end:number)=>{from=start;to=end;return query;},
   then:(resolve:(value:unknown)=>unknown)=>{
    reads.push({table,from,filterSize});
    rows.sort((a,b)=>{for(const key of order){const compared=String(a[key]).localeCompare(String(b[key]));if(compared)return compared;}return 0;});
    const error=failLate&&table==='unit_domains'&&from===500?{message:'Later membership page unavailable'}:null;
    return Promise.resolve(resolve({data:error?null:single?rows[0]:rows.slice(from,Math.min(to,from+999)+1),error}));
   },
  };
  return query;
 }} as unknown as AdminSupabase;
 return {client,units,reads};
}

it('includes every book claim, revision, domain and subject beyond API row and URL limits',async()=>{
 const {client,units,reads}=bookClient();
 const result=await loadArticleClaims(client,units.map(u=>u.id));
 expect(result.claims).toHaveLength(1103);
 expect(result.entities).toHaveLength(1103*6);
 expect(result.claims.every(c=>c.topics.length===6&&c.entityIds.length===6&&c.content.startsWith('Evidence '))).toBe(true);
 expect(result.claims.at(-1)).toMatchObject({unitId:'u1102',content:'Evidence 1102'});
 expect(reads.some(read=>read.table==='unit_domains'&&read.from===500)).toBe(true);
 expect(reads.some(read=>read.table==='unit_entities'&&read.from===500)).toBe(true);
});

it('loads a large existing article completely and keeps only composites inside its evidence',async()=>{
 const {client}=bookClient();
 const result=await loadArticleKnowledge(client,'eu0000-0');
 expect(result.units).toHaveLength(1103);
 expect(result.units.at(-1)).toMatchObject({unitId:'u1102',content:'Evidence 1102'});
 expect(result.units.at(-1)).not.toHaveProperty('memberOf');
 expect(result.units[0]).toMatchObject({memberOf:'u0001'});
});

it('fails a later membership read instead of silently planning with incomplete evidence',async()=>{
 const {client,units}=bookClient(true);
 await expect(loadArticleClaims(client,units.map(u=>u.id))).rejects.toMatchObject({message:'Later membership page unavailable'});
});
