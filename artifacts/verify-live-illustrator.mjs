import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {auth:{persistSession:false}});
const ids = ['281b21e2-8e37-4519-9a86-529d1701a261','af4e217f-a43a-41e4-85e6-f5ccbc88cdf8'];
const {data, error} = await db.from('assets').select('id,title,origin,storage_path,mime_type,attribution,license,deleted_at,created_at').in('id',ids);
if(error) throw error;
const result=[];
for(const asset of data){
  const file=await db.storage.from('composer-images').download(asset.storage_path.replace('composer-images/',''));
  if(file.error) throw file.error;
  const bytes=Buffer.from(await file.data.arrayBuffer());
  const info=await sharp(bytes).metadata();
  if(asset.deleted_at || asset.origin!=='external' || !asset.attribution.includes('commons.wikimedia.org') || !asset.license || !info.width) throw new Error('Invalid saved image');
  result.push({...asset,bytes:bytes.length,width:info.width,height:info.height,format:info.format});
}
if(result.length!==2) throw new Error('Missing image');
await writeFile('artifacts/composer-live/verified-assets.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
