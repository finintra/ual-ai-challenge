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

-- =========================================================
-- v2 migration: supervisor review fields
-- Безпечно запускати повторно (IF NOT EXISTS).
-- =========================================================
alter table submissions add column if not exists review_notes  jsonb       not null default '{}'::jsonb;
alter table submissions add column if not exists review_status text        not null default 'pending';
alter table submissions add column if not exists reviewed_at   timestamptz;

-- Constraint на дозволені значення статусу.
-- pending         — щойно здано, ще не переглянуто
-- approved        — керівник прийняв роботу
-- needs_revision  — потрібно доопрацювати
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_review_status_check'
  ) then
    alter table submissions
      add constraint submissions_review_status_check
      check (review_status in ('pending', 'approved', 'needs_revision'));
  end if;
end$$;

-- =========================================================
-- v3 migration: students registry
-- Реєстр студентів. Адмін-сторінка читає/пише через anon key.
-- Якщо таблиця порожня або Supabase не налаштовано — runtime
-- падає на embedded STUDENTS зі build/submissions.py.
-- =========================================================
create table if not exists public.students (
  slug         text        primary key,
  name         text        not null,
  color        text        not null default '#FF5A3D',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.set_students_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_students_updated_at();

alter table public.students enable row level security;

drop policy if exists "anon read"   on public.students;
drop policy if exists "anon insert" on public.students;
drop policy if exists "anon update" on public.students;
drop policy if exists "anon delete" on public.students;

create policy "anon read"   on public.students for select using (true);
create policy "anon insert" on public.students for insert with check (true);
create policy "anon update" on public.students for update using (true) with check (true);
create policy "anon delete" on public.students for delete using (true);

-- =========================================================
-- v3.1: per-student personal passwords
-- unlock_blob stores the shared `main` password encrypted with the
-- student's personal password (PBKDF2-SHA256 200k iters → AES-GCM).
-- Login flow tries each student's blob with the typed password; a
-- successful decrypt yields recovered `main` and sets the student slug
-- automatically (no picker). Hash-only — plaintext password never lands
-- in Supabase or in the admin UI after entry.
-- =========================================================
alter table public.students
  add column if not exists unlock_blob jsonb;
