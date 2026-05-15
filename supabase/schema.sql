-- AI Challenge · submissions storage
-- Run once in Supabase SQL Editor (https://app.supabase.com/project/_/sql).
-- Then create two GitHub repo secrets:
--   SUPABASE_URL       = https://<project>.supabase.co
--   SUPABASE_ANON_KEY  = <anon public key>

create extension if not exists "pgcrypto";

create table if not exists submissions (
  id            uuid primary key default gen_random_uuid(),
  student_slug  text        not null,
  day_id        text        not null,
  payload       jsonb       not null,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (student_slug, day_id)
);

create index if not exists submissions_student_idx on submissions (student_slug);
create index if not exists submissions_day_idx     on submissions (day_id);

alter table submissions enable row level security;

-- Closed challenge for 2 students — anon key is acceptable for INSERT/UPDATE.
-- If abuse becomes an issue, swap to a small auth flow.
drop policy if exists "anon read"   on submissions;
drop policy if exists "anon insert" on submissions;
drop policy if exists "anon update" on submissions;

create policy "anon read"   on submissions for select using (true);
create policy "anon insert" on submissions for insert with check (true);
create policy "anon update" on submissions for update using (true) with check (true);

-- Auto-update updated_at on PATCH/upsert
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists submissions_set_updated_at on submissions;
create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function set_updated_at();
