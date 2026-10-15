-- Built-in article skills were copying the organization name onto every paragraph.

update public.ai_skills
set
  instructions = replace(
    instructions,
    'Rewrite awkward paragraphs around their subject. Vary sentence length naturally; avoid repetitive openings, forced sets of three, theatrical contrasts, and decorative bold labels.',
    'Rewrite awkward paragraphs around their subject. Vary sentence length naturally; avoid repetitive openings, forced sets of three, theatrical contrasts, and decorative bold labels.
- Name the organization once in a section. Later paragraphs start with the requirement, role, or procedure. Do not begin consecutive sentences or paragraphs with the same proper name, even when the source claims do.'
  ),
  version = version + 1,
  updated_at = now()
where builtin_key in ('define_concepts', 'plan_articles', 'write_articles')
  and instructions like '%avoid repetitive openings%'
  and instructions not like '%Name the organization once in a section%';

insert into public.ai_skill_revisions (skill_id, version, snapshot)
select id, version, to_jsonb(s)
from public.ai_skills s
where builtin_key in ('define_concepts', 'plan_articles', 'write_articles')
  and not exists (
    select 1 from public.ai_skill_revisions r
    where r.skill_id = s.id and r.version = s.version
  );
