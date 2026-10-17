-- Derived, input-fingerprinted model decisions can be reused after interruption.
-- No meaning is published by this cache; lease-fenced publication remains mandatory.
alter table public.glossary_state add column review_cache jsonb not null default '{}';
notify pgrst,'reload schema';
