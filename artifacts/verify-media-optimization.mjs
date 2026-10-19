import { createServer } from 'vite';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
const root=resolve('.');
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null},resolve:{alias:{'@':root,'server-only':join(root,'test/server-only.ts')}}});
try {
  const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const {optimizedMediaResponse}=await runtime.ssrLoadModule('/lib/media/optimize.ts');
  const client=getAdminSupabase();
  const {data,error}=await client.from('assets').select('id,storage_path,mime_type').like('storage_path','composer-images/%').is('deleted_at',null).limit(1).single();
  if(error) throw error;
  let originalSize=0;
  const path=data.storage_path.slice('composer-images/'.length);
  const options={bucket:'composer-images',path,mime:data.mime_type,download:async()=>{
    const file=await client.storage.from('composer-images').download(path);
    if(file.error) throw file.error;
    originalSize=file.data.size;
    return file.data;
  }};
  const first=await optimizedMediaResponse(new Request('http://localhost/image?w=640'),options);
  if(!first) throw new Error('Optimization failed');
  const bytes=Buffer.from(await first.arrayBuffer());
  const info=await sharp(bytes).metadata();
  const second=await optimizedMediaResponse(new Request('http://localhost/image?w=640'),options);
  await second.arrayBuffer();
  console.log(JSON.stringify({assetId:data.id,originalBytes:originalSize,optimizedBytes:bytes.length,format:info.format,width:info.width,cache:second.headers.get('x-media-cache')}));
} finally {await runtime.close();}
