import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
console.log(JSON.stringify(await c.from('workspace_settings').select('auto_update_stale')));
console.log(JSON.stringify(await c.from('sections').select('id,page_id,title,status,build_cancelled,building_since').eq('status','stale').is('retired_at',null)));
