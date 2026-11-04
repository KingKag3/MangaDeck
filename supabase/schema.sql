-- Mangadeck: intake table for volume lists sent in by users.
-- Run once in the Supabase SQL editor.
--
-- The anon key ships inside the app, so row-level security is what keeps this safe:
--   * anyone can INSERT, but only unapproved rows (approved = false)
--   * anyone can SELECT, but only approved rows
--   * nobody can UPDATE or DELETE with the anon key (the maintainer does that in the dashboard)

create table if not exists public.volume_submissions (
  id         bigint generated always as identity primary key,
  titles     text[]      not null check (cardinality(titles) between 1 and 5 and char_length(array_to_string(titles, '|')) <= 400),
  page       text        not null check (char_length(page) <= 80),
  ranges     jsonb       not null check (jsonb_typeof(ranges) = 'array' and jsonb_array_length(ranges) between 1 and 500),
  approved   boolean     not null default false,
  created_at timestamptz not null default now()
);

alter table public.volume_submissions enable row level security;

drop policy if exists "anyone can submit" on public.volume_submissions;
create policy "anyone can submit" on public.volume_submissions
  for insert to anon
  with check (approved = false);

drop policy if exists "anyone can read approved" on public.volume_submissions;
create policy "anyone can read approved" on public.volume_submissions
  for select to anon
  using (approved = true);

-- To approve a submission: Table Editor, open the row, tick `approved`.
