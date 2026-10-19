-- Coverage repair runs before editorial review. Excluding unfinished or empty
-- articles here prevented that repair and let their upload skip required work.
create or replace function public.pages_needing_editorial_review(p_section_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(p.id order by p.id),'[]'::jsonb)
  from public.pages p
  where p.space_id=public.current_space_id() and p.retired_at is null
    -- Keep the page identity after scaffolding replaces its old sections.
    and p.id in(select page_id from public.sections where id=any(p_section_ids))
    and (
      exists(select 1 from public.sections s where s.page_id=p.id and s.retired_at is null and s.status<>'current')
      or public.page_review_content_hash(p.id) is distinct from (
        select snapshot_hash from public.page_review_runs where page_id=p.id order by created_at desc limit 1
      )
    );
$$;
