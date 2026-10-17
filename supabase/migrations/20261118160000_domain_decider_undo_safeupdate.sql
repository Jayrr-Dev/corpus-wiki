-- Supabase safeupdate requires explicit predicates even for full snapshot restore.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('change_control.undo_domain_review_before_decider(uuid)'::regprocedure);
 definition:=replace(definition,'set path=''__domain_undo__/''||id::text;','set path=''__domain_undo__/''||id::text where id is not null;');
 definition:=replace(definition,'delete from public.unit_domains;','delete from public.unit_domains where unit_id is not null;');
 execute definition;
end $$;
