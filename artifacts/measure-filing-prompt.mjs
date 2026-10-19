import {createServer} from 'vite';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try{
 const context=JSON.parse(await readFile('artifacts/current-filing-context.json','utf8'));
 const {uploadAssignmentEvidence}=await runtime.ssrLoadModule('/lib/domains/uploadAssignment.ts');
 const evidence=uploadAssignmentEvidence(context);
 const claims=evidence.claims.slice(527,607),refs=new Set(claims.map(c=>c.ref));
 const relatedRefs=new Set(evidence.links.flatMap(l=>refs.has(l.from)?[l.to]:refs.has(l.to)?[l.from]:[]));
 const parts={overview:evidence.claims.map(c=>({ref:c.ref,title:c.title})),sections:context.sourceSections,claims,relatedClaims:evidence.claims.filter(c=>relatedRefs.has(c.ref)),sourceEvidence:evidence.evidence.filter(c=>refs.has(c.ref)),links:evidence.links.filter(l=>refs.has(l.from)||refs.has(l.to))};
 console.log(JSON.stringify(Object.fromEntries(Object.entries(parts).map(([key,value])=>[key,{characters:JSON.stringify(value).length,count:value.length}]))));
}finally{await runtime.close();}
