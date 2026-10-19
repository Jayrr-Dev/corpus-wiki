import { createServer } from 'vite';
import { resolve, join } from 'node:path';
const root=resolve('.');
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null},resolve:{alias:{'@':root,'server-only':join(root,'test/server-only.ts')}}});
try {
  const { optimizeNextStoredMedia }=await runtime.ssrLoadModule('/lib/media/worker.ts');
  let count=0;
  while(count<20 && await optimizeNextStoredMedia()) { count++; console.log(`Processed stored media ${count}`); }
  console.log(`Automatic storage optimization processed ${count} files.`);
} finally {await runtime.close();}
