create table public.media_optimization_jobs (
  bucket text not null, path text not null, mime text not null,
  lease_until timestamptz, completed_at timestamptz, retry_at timestamptz,
  primary key(bucket,path)
);
alter table public.media_optimization_jobs enable row level security;
revoke all on public.media_optimization_jobs from public,anon,authenticated;
create function public.claim_media_optimization() returns jsonb
language plpgsql security definer set search_path=public as $$
declare job record;
begin
  insert into media_optimization_jobs(bucket,path,mime)
  select 'sources',storage_path,mime_type from sources where storage_path<>'' and archived_at is null
    and mime_type ~ '^(image/(png|jpeg)|video/|audio/)' and mime_type not in ('video/webm','audio/ogg','audio/opus')
  union
  select case when origin='source' then 'sources' else 'composer-images' end,
    case when origin='source' then storage_path else substr(storage_path,length('composer-images/')+1) end,mime_type
  from assets where deleted_at is null and (origin='source' or storage_path like 'composer-images/%')
    and mime_type ~ '^(image/(png|jpeg)|video/|audio/)' and mime_type not in ('video/webm','audio/ogg','audio/opus')
  on conflict(bucket,path) do nothing;
  select bucket,path,mime into job from media_optimization_jobs
    where completed_at is null and (lease_until is null or lease_until<now()) and (retry_at is null or retry_at<now())
    order by bucket,path for update skip locked limit 1;
  if not found then return null; end if;
  update media_optimization_jobs set lease_until=now()+interval '10 minutes' where bucket=job.bucket and path=job.path;
  return jsonb_build_object('bucket',job.bucket,'path',job.path,'mime',job.mime);
end $$;
create function public.finish_media_optimization(p_bucket text,p_path text,p_success boolean) returns void
language sql security definer set search_path=public as $$
  update media_optimization_jobs set lease_until=null,
    completed_at=case when p_success then now() else null end,
    retry_at=case when p_success then null else now()+interval '1 day' end
  where bucket=p_bucket and path=p_path;
$$;
revoke all on function public.claim_media_optimization(),public.finish_media_optimization(text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_media_optimization(),public.finish_media_optimization(text,text,boolean) to service_role;
notify pgrst,'reload schema';
