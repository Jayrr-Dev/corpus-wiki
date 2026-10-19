import {readFile,writeFile} from 'node:fs/promises';
const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qeuvxnvwommyjdzxoodd')throw Error('Refusing to change a different project.');
const headers={Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'};
async function request(path,options={}){
 const response=await fetch(`https://api.supabase.com${path}`,{headers,signal:AbortSignal.timeout(30000),...options});
 if(!response.ok)throw Error(`Realtime configuration request failed: ${response.status}`);
 return response.status===204?null:response.json();
}
const readConfig=async()=>{const result=await request(`/v2/projects/${ref}/config`);return result.data?.attributes??result.data??result;};
const config=await readConfig();
const realtime=config.realtime;
if(typeof realtime?.suspend!=='boolean'){
 console.log('Config shape',JSON.stringify({keys:Object.keys(config),realtimeKeys:realtime?Object.keys(realtime):[]}));
 throw Error('Cannot verify existing Realtime state; leaving it unchanged.');
}
console.log('Current',JSON.stringify({ref,suspended:realtime.suspend}));
const snapshotPath='artifacts/book-realtime-config-before.json';
if(process.argv.includes('--suspend')){
 try{await writeFile(snapshotPath,JSON.stringify({ref,suspend:realtime.suspend,recordedAt:new Date().toISOString()},null,2),{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 await request(`/v1/projects/${ref}/config/realtime`,{method:'PATCH',body:JSON.stringify({suspend:true})});
 const after=await readConfig();
 if(after.realtime?.suspend!==true)throw Error('Realtime suspension not confirmed.');
 console.log('Confirmed: crashing live-update service suspended; saved data unchanged.');
}
if(process.argv.includes('--restore')){
 const original=JSON.parse(await readFile(snapshotPath,'utf8'));
 if(original.ref!==ref||typeof original.suspend!=='boolean')throw Error('Invalid saved configuration');
 await request(`/v1/projects/${ref}/config/realtime`,{method:'PATCH',body:JSON.stringify({suspend:original.suspend})});
 const after=await readConfig();
 if(after.realtime?.suspend!==original.suspend)throw Error('Realtime restore not confirmed.');
 console.log('Confirmed: original Realtime setting restored.');
}
