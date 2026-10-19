CREATE OR REPLACE FUNCTION public.apply_glossary_auto_decision(p_item jsonb, p_candidates jsonb, p_decision text, p_target text, p_definition text, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare state public.glossary_state; item jsonb; candidates jsonb; target jsonb;
begin
 -- Lock the setting through commit so switching off fences in-flight decisions.
 perform 1 from public.workspace_settings where id and glossary_auto_decide for share;
 if not found then return false; end if;
 select * into state from public.glossary_state where id for update;
 if state.lease_until>now() then return false; end if;
 select e into item from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'=p_item->'entry'->>'meaningId';
 if item is null or item is distinct from p_item then return false; end if;
 select coalesce(jsonb_agg(e),'[]') into candidates from jsonb_array_elements(state.entries) e where item->'candidateIds' ? (e->>'meaningId');
 if candidates is distinct from p_candidates then return false; end if;
 if p_reason is null or length(btrim(p_reason))=0 or length(p_reason)>600 then raise exception 'A decision needs a short reason.'; end if;
 if p_decision='merge' then
   select e into target from jsonb_array_elements(candidates) e where e->>'meaningId'=p_target;
   if target is null or coalesce((target->>'keepSeparate')::boolean,false) or coalesce((item->'entry'->>'keepSeparate')::boolean,false) then raise exception 'This meaning must stay separate.'; end if;
   if coalesce((target->>'personEdited')::boolean,false) and target->>'definition' is distinct from p_definition then raise exception 'Auto Decide cannot replace a manual definition.'; end if;
 end if;
 perform change_control.apply_glossary_auto_review(item->'entry'->>'meaningId',p_decision,p_target,p_definition,p_reason);
 return true;
end $function$
