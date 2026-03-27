# Phase 4.2 patch

Adds Supabase email/password authentication and access control for shared storage.

## Required environment variables
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

## Required database table
create table buffalo_app_records (
  id text primary key,
  payload jsonb not null default '[]'::jsonb
);

## Auth
Enable Email auth in Supabase Authentication.
