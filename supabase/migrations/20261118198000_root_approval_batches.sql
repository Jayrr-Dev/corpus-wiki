-- Large filing proposals must not be applied inside the approval button's RPC.
-- Each committed batch advances a durable cursor; workers may restart safely.
grant create on schema public to space_runtime;
create table public.root_approval_jobs (
 space_id uuid not null default public.current_space_id() references public.spaces(id),
 change_set_id uuid not null,
 last_position integer not null default -1,
 state text not null default 'pending' check(state in ('pending','complete')),
 failures integer not null default 0,
 available_at timestamptz not null default now(),
 last_error text,
 primary key(space_id,change_set_id),
 foreign key(space_id,change_set_id) references public.change_sets(space_id,id) on delete cascade
);
alter table public.root_approval_jobs enable row level security;
grant select,insert,update,delete on public.root_approval_jobs to space_runtime;
create policy root_jobs_space on public.root_approval_jobs for all to space_runtime
 using(space_id=(select public.current_space_id())) with check(space_id=(select public.current_space_id()));

alter function public.resolve_exception(uuid,boolean,text) rename to resolve_before_root_batches;
create function public.resolve_exception(p_exception_id uuid,p_accept boolean,p_note text) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare x public.exceptions; s public.change_sets; desired public.exception_status;
begin
 -- Use one lock order for all roots in this proposal.
 select cs.* into s from public.change_sets cs join public.actions a on a.change_set_id=cs.id
 join public.exceptions e on e.action_id=a.id where e.id=p_exception_id for update of cs;
 select * into x from public.exceptions where id=p_exception_id for update;
 if x.id is null then raise exception 'Exception not found'; end if;
 if x.reason::text<>'root_domain_approval' then
   return public.resolve_before_root_batches(p_exception_id,p_accept,p_note);
 end if;
 desired:=case when p_accept then 'accepted' else 'rejected' end;
 if x.status<>'open' then
   if x.status<>desired then raise exception 'This exception already has a different answer.'; end if;
   return jsonb_build_object('eventId',s.event_id,'queued',exists(select 1 from public.root_approval_jobs where change_set_id=s.id and state='pending'));
 end if;
 -- Other proposal types retain the existing all-at-once semantics.
 if (select count(*) from public.actions where change_set_id=s.id)<=100
   or exists(select 1 from public.actions where change_set_id=s.id and type::text not in ('create_domain','place_claim')) then
   return public.resolve_before_root_batches(p_exception_id,p_accept,p_note);
 end if;
 -- Insert before answering: the upload-wakeup trigger must still see waiting.
 insert into public.root_approval_jobs(change_set_id) values(s.id) on conflict do nothing;
 update public.exceptions set status=desired,resolved_at=now(),note=p_note where id=x.id;
 if exists(select 1 from public.exceptions e join public.actions a on a.id=e.action_id
   where a.change_set_id=s.id and e.reason::text='root_domain_approval' and e.status='open') then
   return jsonb_build_object('eventId',null,'queued',true);
 end if;
 update public.actions set outcome='pending' where change_set_id=s.id and outcome='exception';
 update public.change_sets set status='checking' where id=s.id;
 update public.upload_workflows set error=null,progress=jsonb_build_object('step','root-approval','done',0,
   'total',(select count(*) from public.actions where change_set_id=s.id)),updated_at=now() where event_id=s.event_id;
 return jsonb_build_object('eventId',s.event_id,'queued',true);
end $$;

alter function public.upload_workflow_waiting(uuid) rename to upload_waiting_before_root_batches;
create function public.upload_workflow_waiting(p_event_id uuid) returns boolean
language sql stable set search_path='' as $$
 select public.upload_waiting_before_root_batches(p_event_id) or exists(
   select 1 from public.root_approval_jobs j join public.change_sets s on s.id=j.change_set_id
   where s.event_id=p_event_id and j.state='pending')
$$;

create function public.apply_root_approval_batch() returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare j public.root_approval_jobs; s public.change_sets; a public.actions; verdict jsonb; moved boolean;
begin
 select q.* into j from public.root_approval_jobs q where q.state='pending' and q.available_at<=now()
 and not exists(select 1 from public.exceptions e join public.actions act on act.id=e.action_id
   where act.change_set_id=q.change_set_id and e.reason::text='root_domain_approval' and e.status='open')
 order by q.change_set_id for update skip locked limit 1;
 if j.change_set_id is null then return null; end if;
 begin
 select * into s from public.change_sets where id=j.change_set_id for update;
 if j.last_position=-1 then
   select exists(select 1 from public.actions act join public.units u on u.id=act.target_id
     where act.change_set_id=s.id and act.expected_revision_id is not null
     and u.current_revision_id<>act.expected_revision_id) into moved;
   if moved then perform change_control.reject_moved(s); end if;
 end if;
 if not coalesce(moved,false) then
   for a in select * from public.actions where change_set_id=s.id and position>j.last_position order by position limit 25 loop
     -- Lock current claims, then retain all ordinary validation and undo records.
     perform 1 from public.units where id=a.target_id for update;
     if a.expected_revision_id is not null and exists(select 1 from public.units where id=a.target_id and current_revision_id<>a.expected_revision_id) then
       update public.actions set outcome='rejected',check_results=jsonb_build_array(change_control.check('expected_revision',false,'Knowledge changed while this was drafted.')) where id=a.id;
     else
       verdict:=change_control.judge(a,s.proposed_by);
       update public.actions set check_results=verdict->'checks' where id=a.id;
       case verdict->>'outcome'
         when 'applied' then perform change_control.apply_action(a,s.event_id,s.proposed_by);
         when 'exception' then perform change_control.raise_exception(a,(verdict->>'reason')::public.exception_reason,verdict->>'detail');
         else update public.actions set outcome='rejected' where id=a.id;
       end case;
     end if;
     j.last_position:=a.position;
   end loop;
 end if;
 update public.root_approval_jobs set last_position=j.last_position,failures=0,last_error=null where change_set_id=s.id;
 update public.upload_workflows set error=null,progress=jsonb_build_object('step','root-approval','done',j.last_position+1,
   'total',(select count(*) from public.actions where change_set_id=s.id)),updated_at=now() where event_id=s.event_id;
 if coalesce(moved,false) or not exists(select 1 from public.actions where change_set_id=s.id and position>j.last_position) then
   perform change_control.refresh_status(s.id);
   update public.root_approval_jobs set state='complete' where change_set_id=s.id;
   -- Existing durable recovery resumes the upload even if this worker exits now.
   update public.upload_workflows set state='pending',progress=null,error=null,updated_at=now()
     where event_id=s.event_id and state='waiting' and not cancel_requested;
   return jsonb_build_object('eventId',s.event_id,'complete',true,'position',j.last_position);
 end if;
 return jsonb_build_object('eventId',s.event_id,'complete',false,'position',j.last_position);
 exception when query_canceled or others then
   update public.root_approval_jobs set failures=failures+1,last_error=sqlerrm,
     available_at=now()+make_interval(secs=>least(300,15*(failures+1))) where change_set_id=j.change_set_id;
   update public.upload_workflows set error='Applying approved domains paused; saved batches will retry automatically.',updated_at=now()
     where event_id=(select event_id from public.change_sets where id=j.change_set_id);
   return jsonb_build_object('error',sqlerrm,'changeSetId',j.change_set_id);
 end;
end $$;

alter function public.resolve_exception(uuid,boolean,text) owner to space_runtime;
alter function public.upload_workflow_waiting(uuid) owner to space_runtime;
alter function public.apply_root_approval_batch() owner to space_runtime;
revoke all on function public.resolve_exception(uuid,boolean,text),public.apply_root_approval_batch(),public.resolve_before_root_batches(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.resolve_exception(uuid,boolean,text),public.apply_root_approval_batch() to service_role;
grant execute on function public.upload_workflow_waiting(uuid) to service_role,space_runtime;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
