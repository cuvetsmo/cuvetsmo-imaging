-- ============================================================================
-- cuvetsmo-imaging · 0001 · initial schema
-- ============================================================================
-- Five-table schema for the imaging lab:
--   · imaging_cases           — published DICOM cases (peer-reviewed / textbook
--                               / community / CUVET internal)
--   · imaging_case_files      — 1..N storage paths per case (VD, lateral, etc.)
--   · imaging_atlas_entries   — atlas of normal-anatomy reference images
--   · imaging_user_progress   — per-user viewed/mastered state (cases + atlas)
--   · imaging_recall_attempts — per-user active-recall notes + confidence
--
-- RLS conventions in this migration:
--   · USING and WITH CHECK are written separately on UPDATE policies, per
--     `feedback_postgres-rls-with-check`. Without an explicit WITH CHECK,
--     Postgres reuses USING but the semantics differ for state transitions.
--   · `(select auth.uid())` instead of bare `auth.uid()` — caches per query
--     and silences the advisor `auth_rls_initplan` WARN
--     (see knowledge/learnings/supabase-mcp-automation-patterns).
--   · Every FK column has its own b-tree index (see "indexes" section).
--
-- Storage:
--   · `imaging-cases` bucket — PRIVATE. DICOM files served via signed URLs
--     with a 1-hour TTL. Anon can NOT list or read directly.
--   · `imaging-atlas`  bucket — PUBLIC. Atlas JPGs served via getPublicUrl().
--     No SELECT policy needed on storage.objects (public buckets bypass).
--
-- This migration is idempotent. Safe to re-apply.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;
-- gen_random_uuid() comes from pgcrypto; available in newer Supabase by
-- default but enabling here is harmless.


-- ============================================================================
-- 1. imaging_cases
-- ============================================================================
create table if not exists public.imaging_cases (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  species text not null
    check (species in ('canine','feline','equine','bovine','exotic')),
  signalment text,
  history text,
  body_part text
    check (body_part in (
      'thorax','abdomen','pelvis','skull','spine',
      'limb-fore','limb-hind','dental','other'
    )),
  modality text
    check (modality in ('DX','CR','CT','MR','US','RG','OT')),
  difficulty text
    check (difficulty in ('intro','intermediate','advanced')),
  learning_objectives text[],
  credibility text not null
    check (credibility in (
      'peer-reviewed','open-textbook','community',
      'ai-generated','cuvet-internal','sample-demo'
    )),
  license text,
  source_url text,
  attribution text,
  -- recall shape (validated client-side, not DB-constrained, to allow growth):
  --   { findings: string[],
  --     ddx: { name: string, probability?: 'high'|'mid'|'low' }[],
  --     final_diagnosis: string,
  --     teaching_points?: string[],
  --     citation?: string }
  recall jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.imaging_cases is
  'Published clinical imaging cases. Anon can SELECT only is_published=true.
   recall jsonb stores expert findings + DDx + final dx + teaching points.
   Owned by editor pipeline; no per-user write surface yet.';


-- ============================================================================
-- 2. imaging_case_files
-- ============================================================================
create table if not exists public.imaging_case_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null
    references public.imaging_cases(id) on delete cascade,
  view_name text not null,            -- 'VD' | 'lateral' | 'oblique' | ...
  storage_path text not null,         -- 'lab-dicom/<slug>/<view>.dcm'
  mime_type text not null default 'application/dicom',
  byte_size bigint,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.imaging_case_files is
  'Per-case storage refs. storage_path lives in the imaging-cases (PRIVATE)
   bucket and must be served via signed URL (TTL 1h).';


-- ============================================================================
-- 3. imaging_atlas_entries
-- ============================================================================
-- Mirrors lib/atlas.ts AtlasEntry type. Public read.
create table if not exists public.imaging_atlas_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  modality text not null
    check (modality in ('DX','CR','CT','MR','US','RG')),
  species text not null
    check (species in ('canine','feline','equine','bovine','exotic')),
  body_part text not null
    check (body_part in (
      'thorax','abdomen','pelvis','skull','spine',
      'limb-fore','limb-hind','dental','other'
    )),
  view text not null,                 -- 'VD' | 'lateral' | 'right-lateral' | ...
  description text not null,
  learning_landmarks text[],
  image_path text not null,           -- public bucket path: '<slug>.jpg'
  thumbnail_path text,
  license text not null,
  source_url text,
  attribution text,
  credibility text not null
    check (credibility in (
      'peer-reviewed','open-textbook','community',
      'ai-generated','cuvet-internal'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.imaging_atlas_entries is
  'Normal-anatomy reference atlas. Public SELECT for everyone (anon + auth).
   image_path lives in the imaging-atlas (PUBLIC) bucket — getPublicUrl().';


-- ============================================================================
-- 4. imaging_user_progress
-- ============================================================================
-- Per-user state for cases AND atlas entries. Exactly one of case_id /
-- atlas_entry_id is set; the other is NULL.
create table if not exists public.imaging_user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id) on delete cascade,
  case_id uuid
    references public.imaging_cases(id) on delete cascade,
  atlas_entry_id uuid
    references public.imaging_atlas_entries(id) on delete cascade,
  status text not null
    check (status in ('viewed','attempted','mastered','marked-difficult')),
  last_viewed_at timestamptz not null default now(),
  times_viewed int not null default 1,

  -- Exactly one of case_id / atlas_entry_id must be set.
  constraint imaging_user_progress_one_target_chk
    check (
      (case_id is not null and atlas_entry_id is null)
      or (case_id is null and atlas_entry_id is not null)
    )
);

-- Composite uniqueness must split into two partial indexes because
-- `unique(user_id, case_id, atlas_entry_id)` with NULLs allows duplicates
-- in Postgres (two NULLs are not equal). Partials enforce one row per
-- (user, target) regardless of which target type.
create unique index if not exists imaging_user_progress_user_case_uniq
  on public.imaging_user_progress(user_id, case_id)
  where case_id is not null;

create unique index if not exists imaging_user_progress_user_atlas_uniq
  on public.imaging_user_progress(user_id, atlas_entry_id)
  where atlas_entry_id is not null;

comment on table public.imaging_user_progress is
  'Per-user viewed/attempted/mastered/marked-difficult state for cases AND
   atlas entries. Exactly one of case_id/atlas_entry_id set; partial unique
   indexes enforce one row per (user, target) since NULLs in a 3-col UNIQUE
   would otherwise allow duplicates.';


-- ============================================================================
-- 5. imaging_recall_attempts
-- ============================================================================
create table if not exists public.imaging_recall_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id) on delete cascade,
  case_id uuid not null
    references public.imaging_cases(id) on delete cascade,
  notes text not null,
  confidence int not null
    check (confidence between 1 and 5),
  self_scored_accuracy int
    check (self_scored_accuracy is null
           or self_scored_accuracy between 0 and 100),
  revealed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.imaging_recall_attempts is
  'Active-recall log: user typed notes BEFORE revealing the case answer,
   then self-scored. One row per attempt; users can retry a case any time.';


-- ============================================================================
-- Indexes
-- ============================================================================
-- imaging_cases: filter by body_part + modality is the primary list query
create index if not exists imaging_cases_body_modality_idx
  on public.imaging_cases(body_part, modality);

create index if not exists imaging_cases_is_published_idx
  on public.imaging_cases(is_published);

-- imaging_case_files: every FK column gets its own index (see
-- supabase-mcp-automation-patterns "FK covering indexes are one-liners")
create index if not exists imaging_case_files_case_id_idx
  on public.imaging_case_files(case_id, order_index);

-- imaging_atlas_entries: filter by modality + species + body_part
create index if not exists imaging_atlas_entries_filter_idx
  on public.imaging_atlas_entries(modality, species, body_part);

-- imaging_user_progress: "recent" view = order by last_viewed_at desc per user
create index if not exists imaging_user_progress_user_recent_idx
  on public.imaging_user_progress(user_id, last_viewed_at desc);

create index if not exists imaging_user_progress_case_id_idx
  on public.imaging_user_progress(case_id);

create index if not exists imaging_user_progress_atlas_entry_id_idx
  on public.imaging_user_progress(atlas_entry_id);

-- imaging_recall_attempts: per-user per-case attempt history
create index if not exists imaging_recall_attempts_user_case_idx
  on public.imaging_recall_attempts(user_id, case_id);

create index if not exists imaging_recall_attempts_user_id_idx
  on public.imaging_recall_attempts(user_id);


-- ============================================================================
-- Updated-at triggers (imaging_cases + imaging_atlas_entries)
-- ============================================================================
create or replace function public.imaging_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists imaging_cases_touch_updated_at on public.imaging_cases;
create trigger imaging_cases_touch_updated_at
  before update on public.imaging_cases
  for each row execute function public.imaging_touch_updated_at();

drop trigger if exists imaging_atlas_entries_touch_updated_at
  on public.imaging_atlas_entries;
create trigger imaging_atlas_entries_touch_updated_at
  before update on public.imaging_atlas_entries
  for each row execute function public.imaging_touch_updated_at();


-- ============================================================================
-- RLS — enable on all tables
-- ============================================================================
alter table public.imaging_cases           enable row level security;
alter table public.imaging_case_files      enable row level security;
alter table public.imaging_atlas_entries   enable row level security;
alter table public.imaging_user_progress   enable row level security;
alter table public.imaging_recall_attempts enable row level security;


-- ============================================================================
-- RLS · imaging_cases
-- ----------------------------------------------------------------------------
-- Anyone can SELECT published cases. Writes are editor-only (service-role
-- via migration/edge function); no anon/authenticated write surface yet.
-- ============================================================================
drop policy if exists "imaging_cases public read published"
  on public.imaging_cases;
create policy "imaging_cases public read published"
  on public.imaging_cases
  for select
  to anon, authenticated
  using (is_published = true);


-- ============================================================================
-- RLS · imaging_case_files
-- ----------------------------------------------------------------------------
-- Readable if-and-only-if the parent case is published. Joins via EXISTS.
-- ============================================================================
drop policy if exists "imaging_case_files public read if case published"
  on public.imaging_case_files;
create policy "imaging_case_files public read if case published"
  on public.imaging_case_files
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.imaging_cases c
      where c.id = imaging_case_files.case_id
        and c.is_published = true
    )
  );


-- ============================================================================
-- RLS · imaging_atlas_entries
-- ----------------------------------------------------------------------------
-- Atlas is fully public read. Writes editor-only (service-role).
-- ============================================================================
drop policy if exists "imaging_atlas_entries public read"
  on public.imaging_atlas_entries;
create policy "imaging_atlas_entries public read"
  on public.imaging_atlas_entries
  for select
  to anon, authenticated
  using (true);


-- ============================================================================
-- RLS · imaging_user_progress  (owner-only · all four verbs)
-- ----------------------------------------------------------------------------
-- USING + WITH CHECK written separately on UPDATE per
-- `feedback_postgres-rls-with-check`. `(select auth.uid())` caches the
-- subquery once per statement instead of per row.
-- ============================================================================
drop policy if exists "imaging_user_progress self select"
  on public.imaging_user_progress;
create policy "imaging_user_progress self select"
  on public.imaging_user_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "imaging_user_progress self insert"
  on public.imaging_user_progress;
create policy "imaging_user_progress self insert"
  on public.imaging_user_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "imaging_user_progress self update"
  on public.imaging_user_progress;
create policy "imaging_user_progress self update"
  on public.imaging_user_progress
  for update
  to authenticated
  using       ((select auth.uid()) = user_id)
  with check  ((select auth.uid()) = user_id);

drop policy if exists "imaging_user_progress self delete"
  on public.imaging_user_progress;
create policy "imaging_user_progress self delete"
  on public.imaging_user_progress
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================================
-- RLS · imaging_recall_attempts  (owner-only · all four verbs)
-- ----------------------------------------------------------------------------
-- Same shape as imaging_user_progress.
-- ============================================================================
drop policy if exists "imaging_recall_attempts self select"
  on public.imaging_recall_attempts;
create policy "imaging_recall_attempts self select"
  on public.imaging_recall_attempts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "imaging_recall_attempts self insert"
  on public.imaging_recall_attempts;
create policy "imaging_recall_attempts self insert"
  on public.imaging_recall_attempts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "imaging_recall_attempts self update"
  on public.imaging_recall_attempts;
create policy "imaging_recall_attempts self update"
  on public.imaging_recall_attempts
  for update
  to authenticated
  using       ((select auth.uid()) = user_id)
  with check  ((select auth.uid()) = user_id);

drop policy if exists "imaging_recall_attempts self delete"
  on public.imaging_recall_attempts;
create policy "imaging_recall_attempts self delete"
  on public.imaging_recall_attempts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================================
-- Storage buckets — imaging-cases (PRIVATE) + imaging-atlas (PUBLIC)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('imaging-cases', 'imaging-cases', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('imaging-atlas', 'imaging-atlas', true)
on conflict (id) do update set public = true;


-- ============================================================================
-- Storage policies · imaging-cases (PRIVATE bucket)
-- ----------------------------------------------------------------------------
-- No anon/auth direct SELECT. All reads go through signed URLs generated
-- server-side (createSignedUrl, TTL 1h) for files belonging to published
-- cases. This means the only SELECT policy is for authenticated users via
-- signed URLs — which bypass RLS anyway. So we deliberately add no SELECT
-- policy here; signed URLs use the bucket's signing path, not RLS.
--
-- Writes: editor-only. No anon/auth INSERT/UPDATE/DELETE policy.
-- service_role inserts via Edge Function or seed script.
-- ============================================================================
-- (Intentional no-op: PRIVATE bucket + signed URLs + service_role writes.)


-- ============================================================================
-- Storage policies · imaging-atlas (PUBLIC bucket)
-- ----------------------------------------------------------------------------
-- Public buckets bypass RLS for direct file reads via getPublicUrl().
-- An explicit SELECT policy is unnecessary (per
-- supabase-mcp-automation-patterns "Public bucket SELECT policy can be
-- dropped" — app never calls .list() on this bucket).
--
-- Writes: editor-only via service_role.
-- ============================================================================
-- (Intentional no-op: PUBLIC bucket + getPublicUrl + service_role writes.)


-- ============================================================================
-- Notes for the reviewer applying this migration
-- ----------------------------------------------------------------------------
-- 1. Apply via supabase-cuvetsmo MCP `apply_migration` with name
--    `0001_imaging_schema` (matches the file slug). The MCP will record it
--    in supabase_migrations.schema_migrations.
--
-- 2. After apply, run:
--      mcp__supabase-cuvetsmo__get_advisors --type security
--      mcp__supabase-cuvetsmo__get_advisors --type performance
--    Expected clean output. If WARN appears, categorize per
--    supabase-mcp-automation-patterns "advisor categorization framework".
--
-- 3. Then run:
--      mcp__supabase-cuvetsmo__generate_typescript_types
--    Replace the hand-written types/database.ts with the result.
--
-- 4. Seed path: parent decides whether to lift 17 VetMock CC cases or wire
--    a fresh seed script. Either way, writes go through service_role (no
--    public RLS write policies exist).
-- ============================================================================
