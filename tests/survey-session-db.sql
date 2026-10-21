-- Dedicated EMPTY database only. Never run this bootstrap on a live project.
\set ON_ERROR_STOP on
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end;$$;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
-- Stub the Supabase Storage metadata needed by the actual base schema.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
\ir ../supabase/schema.sql
\ir ../supabase/survey_session_delete.sql
-- Mirror table grants; the real RLS policies must enforce ownership.
grant select,insert,update,delete on public.surveys,public.sessions,public.participants,public.responses to anon,authenticated;
\ir survey-session-access.sql
