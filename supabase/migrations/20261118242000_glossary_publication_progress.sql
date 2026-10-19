-- A recovery claim resets extraction counters before replaying a staged publication.
-- Successful publication is proof that every extraction batch finished.
do $$ declare definition text; begin
 select pg_get_functiondef('public.publish_glossary_meanings(uuid,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
 if position('batches=p_batches,input_hash=p_hash' in definition)=0 then
   raise exception 'Unexpected glossary publication definition';
 end if;
 execute replace(definition,'batches=p_batches,input_hash=p_hash',
   'batches=p_batches,completed_batches=total_batches,input_hash=p_hash');
end $$;
