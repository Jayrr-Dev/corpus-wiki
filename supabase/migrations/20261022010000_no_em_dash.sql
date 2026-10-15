-- The built-in writing policy told the model to keep dashes. Article prose
-- must not use em dashes or en dashes. Hyphens in compound words stay.

update public.ai_skills
set
  instructions = replace(
    replace(instructions, 'encyclopedia-humanizer-v1', 'encyclopedia-humanizer-v2'),
    'Choose punctuation for the sentence''s meaning. Keep genuine comparisons, technical terminology, proper names, and exact quotations; do not mechanically replace every formal word or dash.',
    'Do not use em dashes or en dashes. Use a comma, period, colon, or parentheses. Keep hyphens inside compound words, and keep genuine comparisons, technical terminology, proper names, and exact quotations.'
  ),
  version = version + 1,
  updated_at = now()
where builtin_key in ('define_concepts', 'plan_articles', 'write_articles')
  and instructions like '%do not mechanically replace every formal word or dash%';

insert into public.ai_skill_revisions (skill_id, version, snapshot)
select id, version, to_jsonb(s)
from public.ai_skills s
where builtin_key in ('define_concepts', 'plan_articles', 'write_articles')
  and not exists (
    select 1 from public.ai_skill_revisions r
    where r.skill_id = s.id and r.version = s.version
  );
