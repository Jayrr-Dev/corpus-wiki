-- New enum values cannot be used in the transaction that adds them (see 20261107110000_place_claim_type.sql)
alter type public.action_type add value if not exists 'set_member';
