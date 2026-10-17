-- OrioleDB can fail while constructing one JSON object directly from these
-- toasted columns (XX000: invalid memory alloc request size). Each column
-- reads correctly by itself. Materialize independent owned values first.
-- STABLE keeps both reads on the invoking statement's snapshot.
create or replace function public.get_glossary_auto_decide() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare saved jsonb; pending jsonb;
begin
  if not coalesce((select s.glossary_auto_decide from public.workspace_settings s where s.id),false) then
    return null;
  end if;
  select (g.entries::text)::jsonb into saved
    from public.glossary_state g
    where g.id and (g.lease_until is null or g.lease_until<=now());
  if saved is null then return null; end if;
  select (g.pending_entries::text)::jsonb into pending from public.glossary_state g where g.id;
  return jsonb_build_object('entries',saved,'pending',pending);
end $$;
notify pgrst,'reload schema';
