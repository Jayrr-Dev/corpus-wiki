-- Keep the media and provenance so library deletion can always be undone.
alter table public.assets add column deleted_at timestamptz;
notify pgrst,'reload schema';
