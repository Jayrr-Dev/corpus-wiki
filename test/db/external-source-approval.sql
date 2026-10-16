-- Execute inside a transaction and ROLLBACK: no test sources are retained.
do $$
declare sid uuid:=gen_random_uuid(); approved_id uuid:=gen_random_uuid(); source_url text:='https://example.org/verification/'||sid;
begin
  begin
    insert into public.sources(id,title,mime_type,source_date,hash,storage_path,origin,url)
      values(sid,'Approval verification','text/markdown',now(),sid::text,'verification/'||sid,'external',source_url);
    raise exception 'Unapproved source admitted';
  exception when others then
    if sqlerrm not like 'External sources require independent approval%' then raise; end if;
  end;
  insert into public.sources(id,title,mime_type,source_date,hash,storage_path)
    values(sid,'Approval verification','text/markdown',now(),sid::text,'verification/'||sid);
  insert into public.external_source_reviews(id,source_id,stage,outcome,context,proposal,reason,url,source_title)
    values(approved_id,sid,'source','rejected','{}','{}','Verification only',source_url,'Approval verification');
  begin
    update public.sources set origin='external',url=source_url where id=sid;
    raise exception 'Rejected source admitted';
  exception when others then
    if sqlerrm not like 'External sources require independent approval%' then raise; end if;
  end;
  update public.external_source_reviews set outcome='approved' where id=approved_id;
  update public.sources set origin='external',url=source_url where id=sid;
  if not exists(select 1 from public.sources where id=sid and origin='external') then raise exception 'Approved source not admitted'; end if;
  begin
    update public.sources set url=source_url||'/unreviewed' where id=sid;
    raise exception 'Approval reused for different URL';
  exception when others then
    if sqlerrm not like 'External sources require independent approval%' then raise; end if;
  end;
end $$;
