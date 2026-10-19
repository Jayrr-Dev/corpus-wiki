import { createServer } from 'vite';
import { resolve } from 'node:path';
process.env.COMPOSER_AUTO_ENABLED='false';
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try {
  const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
  await withSpaceActor({personId:'2b0df6b8-81b1-41e9-86b2-2f3f615c00b2',spaceId:'21132c80-32b3-4ef2-9156-d9af60486173',via:'script'},async()=>{
    const {getServerDeps}=await runtime.ssrLoadModule('/lib/server/deps.ts');
    const deps=await getServerDeps();
    if(!deps.articleVerifier)throw Error('Configured article reviewer is required');
    await deps.articleVerifier('811105ea-fcfe-4ac4-9c7d-dc589b1501e4');
    console.log('All affected articles have current complete reviews.');
  });
} finally {await runtime.close();}
