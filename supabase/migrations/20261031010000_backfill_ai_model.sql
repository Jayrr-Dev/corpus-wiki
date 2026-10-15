-- BACKFILL: AI WORK WITH NO RECORDED MODEL
-- Older AI rows were saved without a model (rule-based page proposals, or before
-- models were stamped). Everything so far ran on GLM-5.3-Flash, so they are
-- attributed to it. People's changes are left as they are.

update public.change_sets set model_version = 'zai-org/GLM-5.3-Flash' where proposed_by = 'ai' and model_version is null;
update public.revisions set model_version = 'zai-org/GLM-5.3-Flash' where author = 'ai' and model_version is null;
update public.line_revisions set model_version = 'zai-org/GLM-5.3-Flash' where author = 'ai' and model_version is null;
update public.entities set description_model = 'zai-org/GLM-5.3-Flash' where description is not null and description_model is null;
