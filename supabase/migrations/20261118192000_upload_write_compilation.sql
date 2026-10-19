-- Book batches are short transactional writes. Nested policy/validation plans
-- can incur seconds of LLVM compilation on a cold pooled connection, exhausting
-- PostgREST's eight-second statement budget before the batch can commit.
-- Keep the change local to this function (including its nested checks); restore
-- the caller's setting automatically on return. No checks or indexes change.
alter function public.upload_workflow_write(uuid,uuid,text,text,jsonb) set jit=off;
notify pgrst,'reload schema';
