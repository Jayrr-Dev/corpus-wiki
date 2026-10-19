-- Accept an expanded heading only when it retains every original subject word.
-- Similar but distinct subjects (vertical vs horizontal, phase 1 vs phase 2)
-- must keep separate illustration sections.
create or replace function public.composer_heading_similarity(p_left text,p_right text) returns double precision
language sql immutable set search_path=public as $$
  with words as (
    select distinct word,side from (values (lower(p_left),1),(lower(p_right),2)) v(title,side)
    cross join lateral regexp_split_to_table(coalesce(title,''),'[^[:alnum:]]+') word
    where (length(word)>1 or word ~ '^[0-9]+$')
      and word not in ('and','the','to','of','for','with','between')
  ), grouped as (select word,count(*) n from words group by word)
  select case when (select count(*) from words where side=2)>0
    and count(*) filter(where n=2)=(select count(*) from words where side=2)
    then count(*) filter(where n=2)::double precision/nullif(count(*),0) else 0 end from grouped;
$$;
notify pgrst,'reload schema';
