-- Replace the forced "name the organization once" rule with Wikipedia opening patterns.

update public.ai_skills
set
  instructions = replace(
    instructions,
    'Name the organization once in a section. Later paragraphs start with the requirement, role, or procedure. Do not begin consecutive sentences or paragraphs with the same proper name, even when the source claims do.',
    'Vary how a paragraph opens. A proper name, a pronoun, a person, a date, or the specific procedure can all be the subject. Repeating the name is fine when the next sentence would be unclear. Opening patterns from the Houthis article, for rhythm only. Do not copy these facts. Lead: ''The Houthis, officially known as Ansar Allah, are a political and paramilitary organization that emerged from Yemen in the 1990s. It is predominantly made up of Zaydis.'' Next paragraph: ''Under the leadership of Hussein al-Houthi, the Houthis emerged as an opposition movement.'' Later: ''The organization played a role in the Yemeni Revolution.'' A section can open on a smaller subject: ''The Believing Youth established school clubs and summer camps.'' Or on who said it: ''According to Ahmed Addaghashi, the Houthis began as a moderate theological movement.'''
  ),
  version = version + 1,
  updated_at = now()
where builtin_key in ('define_concepts', 'plan_articles', 'write_articles')
  and instructions like '%Name the organization once in a section%';

insert into public.ai_skill_revisions (skill_id, version, snapshot)
select id, version, to_jsonb(s)
from public.ai_skills s
where builtin_key in ('define_concepts', 'plan_articles', 'write_articles')
  and not exists (
    select 1 from public.ai_skill_revisions r
    where r.skill_id = s.id and r.version = s.version
  );
