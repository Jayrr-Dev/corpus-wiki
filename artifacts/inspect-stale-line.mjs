import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
console.log(JSON.stringify(await c.from('section_lines').select('*').ilike('content','%This program sets rules%')));

