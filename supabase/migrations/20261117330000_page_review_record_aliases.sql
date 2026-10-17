-- Avoid SQL aliases that collide with PL/pgSQL line and revision records.
create or replace function public.complete_page_review(p_page_id uuid,p_snapshot jsonb,p_review jsonb,p_edits jsonb,p_trace jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare findings jsonb; edit jsonb; submitted jsonb; cs uuid; ev uuid; a public.actions; l public.lines; s public.sections; lr public.line_revisions; draft jsonb:='[]'; cites jsonb; covered jsonb;
begin
 lock table public.pages,public.sections,public.lines,public.line_revisions,public.units,public.revisions,public.passages,public.sources in share row exclusive mode;
 if p_snapshot is distinct from public.page_review_snapshot(p_page_id) then raise exception 'The page or evidence changed. Run the review again.'; end if;
 if jsonb_typeof(p_edits) is distinct from 'array' or jsonb_array_length(p_edits)>24 then raise exception 'Invalid edits'; end if;
 if exists(select 1 from jsonb_array_elements(p_edits) e group by e->>'targetId' having count(*)>1) then raise exception 'Conflicting edits'; end if;
 -- Every claim a section cites now must still be cited by one of its lines afterwards (checked after the edits apply)
 covered:=(select coalesce(jsonb_agg(distinct jsonb_build_object('s',covered_line.section_id,'r',r)),'[]'::jsonb)
   from public.lines covered_line join public.line_revisions covered_revision on covered_revision.id=covered_line.current_revision_id join public.sections sc on sc.id=covered_line.section_id
   cross join unnest(covered_revision.unit_revision_ids) r where sc.page_id=p_page_id and sc.retired_at is null and covered_line.retired_at is null);
 for edit in select value from jsonb_array_elements(p_edits) loop
   if edit->>'type'='revise_line' then
     select * into l from public.lines where id=(edit->>'targetId')::uuid and retired_at is null;
     select * into s from public.sections where id=l.section_id and page_id=p_page_id and retired_at is null and mode='generated';
     select * into lr from public.line_revisions where id=l.current_revision_id;
     if s.id is null or lr.author is distinct from 'ai' or nullif(btrim(edit->>'text'),'') is null or length(edit->>'text')>12000 then raise exception 'Invalid line rewrite'; end if;
     -- A fact-checked rewrite carries the citations of what it now says, drawn only from claims the page already cites
     if edit ? 'unitRevisionIds' then
       if jsonb_typeof(edit->'unitRevisionIds') is distinct from 'array' or jsonb_array_length(edit->'unitRevisionIds')=0
          or exists(select 1 from jsonb_array_elements_text(edit->'unitRevisionIds') r where not exists(
            select 1 from public.section_lines pl where pl.page_id=p_page_id and r.value::uuid=any(pl.unit_revision_ids))) then raise exception 'Invalid line citations'; end if;
       cites:=edit->'unitRevisionIds';
     else cites:=to_jsonb(lr.unit_revision_ids); end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','revise_line','targetId',l.id,'input',jsonb_build_object(
       'content',edit->>'text','unitRevisionIds',cites,'expectedLineRevisionId',lr.id,'reason',edit->>'reason')));
   elsif edit->>'type'='retire_line' then
     -- Merging two paragraphs, or dropping one that repeats another of its section
     select * into l from public.lines where id=(edit->>'targetId')::uuid and retired_at is null;
     select * into s from public.sections where id=l.section_id and page_id=p_page_id and retired_at is null and mode='generated';
     select * into lr from public.line_revisions where id=l.current_revision_id;
     if s.id is null or lr.author is distinct from 'ai' then raise exception 'Invalid line removal'; end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','retire_line','targetId',l.id,'input',jsonb_build_object('expectedLineRevisionId',lr.id,'reason',edit->>'reason')));
   elsif edit->>'type'='rename_section' then
     select * into s from public.sections where id=(edit->>'targetId')::uuid and page_id=p_page_id and retired_at is null and mode='generated';
     if s.id is null or lower(s.title)='overview' or nullif(btrim(edit->>'text'),'') is null or length(edit->>'text')>150 or lower(edit->>'text')='overview'
        or exists(select 1 from public.sections where page_id=p_page_id and retired_at is null and id<>s.id and lower(title)=lower(edit->>'text')) then raise exception 'Invalid heading'; end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','rename_section','targetId',s.id,'input',jsonb_build_object('title',edit->>'text','reason',edit->>'reason')));
   elsif edit->>'type'='retire_section' then
     select * into s from public.sections where id=(edit->>'targetId')::uuid and page_id=p_page_id and retired_at is null and mode='generated';
     if s.id is null or lower(s.title)='overview' or not exists(select 1 from public.lines where section_id=s.id and retired_at is null) then raise exception 'Invalid duplicate section'; end if;
     -- Every line must have a verbatim-equivalent, identically cited survivor in Overview.
     if exists(select 1 from public.lines dl join public.line_revisions dr on dr.id=dl.current_revision_id
       where dl.section_id=s.id and dl.retired_at is null and (dr.author<>'ai' or cardinality(dr.unit_revision_ids)=0 or not exists(
         select 1 from public.lines kl join public.line_revisions kr on kr.id=kl.current_revision_id join public.sections ks on ks.id=kl.section_id
         where ks.page_id=p_page_id and ks.retired_at is null and lower(ks.title)='overview' and kl.retired_at is null
           and change_control.review_normalized_text(kr.content)=change_control.review_normalized_text(dr.content)
           and kr.unit_revision_ids @> dr.unit_revision_ids and dr.unit_revision_ids @> kr.unit_revision_ids))) then raise exception 'Section contains distinct information; an exception is required'; end if;
     -- Do not rewrite the surviving introduction in the same repair.
     if exists(select 1 from jsonb_array_elements(p_edits) e join public.lines el on el.id=(e->>'targetId')::uuid join public.sections es on es.id=el.section_id where e->>'type'='revise_line' and lower(es.title)='overview') then raise exception 'Keep the introduction intact while consolidating'; end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','retire_section','targetId',s.id,'input',jsonb_build_object('reason',edit->>'reason')));
   else raise exception 'Unsupported editorial edit'; end if;
 end loop;
 findings:=public.record_page_review(p_page_id,p_snapshot,p_review,p_trace);
 if jsonb_array_length(draft)>0 then
   submitted:=public.submit_change_set(null,'edit','ai','Page reviewer: '||(p_snapshot->'page'->>'title'),p_trace,draft);
   cs:=(submitted->>'changeSetId')::uuid; ev:=(submitted->>'eventId')::uuid;
   update public.change_sets set actor_attribution=jsonb_build_object('proposedBy',jsonb_build_object('role','reviewer','model',p_trace->>'modelVersion'),'decidedBy',jsonb_build_object('role','reviewer','model',p_trace->>'modelVersion')) where id=cs;
   for a in select * from public.actions where change_set_id=cs order by position loop
     perform change_control.apply_action(a,ev,'ai');
   end loop;
   perform change_control.refresh_status(cs);
   if exists(select 1 from jsonb_array_elements(covered) c
     join public.sections sc on sc.id=(c->>'s')::uuid and sc.retired_at is null
     where not exists(select 1 from public.lines surviving_line join public.line_revisions surviving_revision on surviving_revision.id=surviving_line.current_revision_id
       where surviving_line.section_id=sc.id and surviving_line.retired_at is null and (c->>'r')::uuid=any(surviving_revision.unit_revision_ids))) then
     raise exception 'A review edit would leave a claim unstated in its section'; end if;
 end if;
 insert into public.page_review_runs(page_id,summary,edits,exceptions,change_set_id,snapshot_hash)
 values(p_page_id,p_review->>'summary',jsonb_array_length(draft),(findings->>'exceptions')::integer,cs,case when p_review->>'coverageComplete'='false' then 'partial:'||public.page_review_content_hash(p_page_id) else public.page_review_content_hash(p_page_id) end);
 return findings||jsonb_build_object('edits',jsonb_array_length(draft),'changeSetId',cs,'summary',p_review->>'summary');
end $$;
