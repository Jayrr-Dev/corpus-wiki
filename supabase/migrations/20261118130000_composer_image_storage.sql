do $$ begin
if to_regclass('storage.buckets') is not null then
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('composer-images','composer-images',false,20971520,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
end if;
end $$;
