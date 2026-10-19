-- Profile details are private to their account, just like that account's spaces.
alter policy profiles_read on public.profiles using (id=auth.uid());
alter policy profiles_server on public.profiles using (
  id=nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid
);
