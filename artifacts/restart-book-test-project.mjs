const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qeuvxnvwommyjdzxoodd')throw Error('Unexpected project');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/restart`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(45000)});
console.log(JSON.stringify({ref,action:'restart',httpStatus:response.status,accepted:response.ok}));
if(!response.ok)throw Error(`Project restart ${response.status}`);
