-- PLACE_CLAIM: files an existing claim into topics (its own migration: Postgres cannot use
-- an enum value in the transaction that adds it). Its functions follow in 20261107120000.
alter type public.action_type add value if not exists 'place_claim';
