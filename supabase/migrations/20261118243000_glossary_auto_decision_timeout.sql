-- Auto Decide updates the same large JSON dictionary as publication. Avoid
-- compiling its nested JSON/trigger queries on every individual decision.
-- The setting is local to the call and also covers validation and audit writes.
alter function public.apply_glossary_auto_decision(jsonb,jsonb,text,text,text,text) set jit=off;
