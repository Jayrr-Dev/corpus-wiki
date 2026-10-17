-- Cross-filing adds a navigation membership without removing the source.
-- The existing snapshot fence, organizational checks, auditing and undo apply.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('change_control.apply_update_domain(public.actions)'::regprocedure);
 if position('elsif op->>''operation''=''assign'' then' in definition)=0 then raise exception 'Expected assignment dispatcher not found'; end if;
 definition:=replace(definition,'elsif op->>''operation''=''assign'' then','elsif op->>''operation'' in (''assign'',''cross_file'') then');
 definition:=replace(definition,'if dest.id is null or (op->>''sourcePath'' is not null and d.id is null) then',
 'if (op->>''operation''=''cross_file'' and d.id is null) or dest.id is null or (op->>''sourcePath'' is not null and d.id is null) then');
 definition:=replace(definition,'if d.id is distinct from dest.id then delete from public.unit_domains',
 'if op->>''operation''=''assign'' and d.id is distinct from dest.id then delete from public.unit_domains');
 execute definition;
end $$;
