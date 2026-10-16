-- MERGE_ENTITY: folds a duplicate entity into the one that stays (its own migration: Postgres
-- cannot use an enum value in the transaction that adds it). Its functions follow in 20261108100000.
alter type public.action_type add value if not exists 'merge_entity';
