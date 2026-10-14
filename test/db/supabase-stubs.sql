-- =====================================================================
-- SUPABASE STUBS FOR A PLAIN POSTGRES 16
-- Just enough of what Supabase provides for the migration and seed to
-- run unchanged: the API roles, auth and storage schemas, and the
-- Realtime publication. Never applied to a real Supabase project.
-- =====================================================================

-- API ROLES (the Data API switches to these per request)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- AUTH: users table and the helpers RLS policies call
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

-- STORAGE: the buckets table the migration inserts into
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);

-- REALTIME: the publication the migration adds tables to
create publication supabase_realtime;
