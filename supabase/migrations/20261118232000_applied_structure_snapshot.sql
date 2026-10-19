-- Applying a plan binds it to the actual article atomically. Concurrent edits
-- cannot leave a stale payload incorrectly marked as a fresh applied structure.
create or replace function public.stamp_article_structure_basis() returns trigger
language plpgsql set search_path='' as $$
declare live jsonb;
begin
 if tg_op='INSERT' or new.status='applied' then
  live:=public.article_structure_snapshot(new.page_id);
  new.basis_hash:=md5(live::text);
  if new.status='applied' then new.structure:=live; end if;
 end if;
 return new;
end $$;
