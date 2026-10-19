import { createServer } from 'vite';
import { resolve, join } from 'node:path';
const root=resolve('.');
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null},resolve:{alias:{'@':root,'server-only':join(root,'test/server-only.ts')}}});
try {
  const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const {composeLivePage,shownIllustrations}=await runtime.ssrLoadModule('/lib/composer/live.ts');
  const db=supabaseRpc(getAdminSupabase());
  const pageId='73963b81-1961-4b0d-8865-aea76fbcb3a3';
  console.log('Recovering illustrations for the current article.');
  console.log(JSON.stringify(await composeLivePage(db,pageId)));
  const current=await db.call('read_composer_run',{p_page_id:pageId});
  console.log(JSON.stringify({shown:shownIllustrations(current).map(f=>({id:f.id,after:f.after,src:f.src,assetId:f.assetId}))}));
} finally {await runtime.close();}
