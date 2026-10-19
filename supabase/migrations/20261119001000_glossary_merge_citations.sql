-- JSON extraction and concatenation have the same operator precedence.
-- Without parentheses the second -> extracts from the concatenated array,
-- yielding NULL and silently erasing both meanings' source citations.
do $$
declare signature text; definition text; patched text;
begin
 foreach signature in array array[
  'change_control.resolve_glossary_pending_before_fencing(text,text,text,text)',
  'change_control.apply_glossary_auto_review(text,text,text,text,text)'
 ] loop
  definition := pg_get_functiondef(signature::regprocedure);
  patched := replace(definition,
   'jsonb_array_elements(target->''citations''||proposed->''citations'')',
   'jsonb_array_elements(coalesce(target->''citations'',''[]''::jsonb)||coalesce(proposed->''citations'',''[]''::jsonb))');
  if patched = definition then
   raise exception 'Glossary merge implementation changed: %', signature;
  end if;
  execute patched;
 end loop;
end $$;
