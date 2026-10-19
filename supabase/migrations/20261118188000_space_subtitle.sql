-- Retain the AI subtitle with the exact name it describes. A rename makes
-- the old subtitle ineligible until a new one is generated.
alter table public.spaces
  add column subtitle text check (char_length(subtitle) between 1 and 180),
  add column subtitle_for_name text;
