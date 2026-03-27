# Phase 4.1 patch

Adds Supabase-ready shared storage with local browser fallback.

## Required environment variables
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

## Required database table
create table buffalo_app_records (
  id text primary key,
  payload jsonb not null default '[]'::jsonb
);
