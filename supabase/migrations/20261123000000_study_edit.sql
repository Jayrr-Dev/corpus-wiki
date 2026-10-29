-- =====================================================================
-- SECOND BRAIN · STUDY EDITING (admin)
-- =====================================================================
-- Admin mode can rename a set, delete a set, and edit a question's text.
-- Adding a question by hand reuses add_study_items. Same ownership as the
-- other study functions: owned by space_runtime, run by the server only.
-- =====================================================================

grant create on schema public to space_runtime;

-- WRITE: a set's new title
create function public.rename_study_set(p_set_id uuid, p_title text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.study_sets set title = btrim(p_title) where id = p_set_id;
  if not found then raise exception 'This set was removed.' using errcode = 'P0002'; end if;
end;
$$;

-- WRITE: deletes a set with its questions and their answers (study_items and study_attempts cascade).
-- Levels on the claims (study_progress) stay, because several sets can test one claim.
create function public.delete_study_set(p_set_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.study_sets where id = p_set_id;
$$;

-- WRITE: a question's text (the prompt). Its answer, choices and claim stay as they are.
create function public.update_study_item_prompt(p_item_id uuid, p_prompt text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.study_items set prompt = btrim(p_prompt) where id = p_item_id;
  if not found then raise exception 'This question was removed.' using errcode = 'P0002'; end if;
end;
$$;

alter function public.rename_study_set(uuid, text) owner to space_runtime;
revoke execute on function public.rename_study_set(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_study_set(uuid, text) to service_role, space_runtime;

alter function public.delete_study_set(uuid) owner to space_runtime;
revoke execute on function public.delete_study_set(uuid) from public, anon, authenticated;
grant execute on function public.delete_study_set(uuid) to service_role, space_runtime;

alter function public.update_study_item_prompt(uuid, text) owner to space_runtime;
revoke execute on function public.update_study_item_prompt(uuid, text) from public, anon, authenticated;
grant execute on function public.update_study_item_prompt(uuid, text) to service_role, space_runtime;

revoke create on schema public from space_runtime;

notify pgrst, 'reload schema';
