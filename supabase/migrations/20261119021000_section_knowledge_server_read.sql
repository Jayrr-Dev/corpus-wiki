-- Server jobs (article suggestions) read which knowledge articles cite.
-- The view is security_invoker, so space policies on its tables still apply.
grant select on public.section_knowledge to space_runtime;
notify pgrst, 'reload schema';
