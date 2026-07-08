-- Welfare Resource Radar Supabase schema
-- 1) Supabase SQL Editor에서 실행하세요.
-- 2) 실제 기관 공유 전에 RLS 정책을 기관 환경에 맞게 재검토하세요.

create extension if not exists "pgcrypto";

create table if not exists public.radar_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'staff' check (role in ('staff', 'manager', 'admin')),
  organization text default '제천종합사회복지관',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radar_resources (
  id text primary key,
  title text not null,
  agency text,
  category text,
  region text,
  targets jsonb not null default '[]'::jsonb,
  deadline date,
  urgency text default '보통',
  status text default '검토 필요',
  summary text,
  apply_method text,
  contact text,
  source_url text,
  tags jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radar_beneficiaries (
  id text primary key,
  display_name text not null,
  age text,
  household text,
  needs text,
  region text,
  memo text,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radar_resource_matches (
  id uuid primary key default gen_random_uuid(),
  resource_id text references public.radar_resources(id) on delete cascade,
  beneficiary_id text references public.radar_beneficiaries(id) on delete cascade,
  score integer not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(resource_id, beneficiary_id)
);

create table if not exists public.radar_workflow_checks (
  id uuid primary key default gen_random_uuid(),
  resource_id text references public.radar_resources(id) on delete cascade,
  checklist jsonb not null default '{}'::jsonb,
  memo text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(resource_id)
);

create table if not exists public.radar_ops_logs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  message text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.radar_profiles enable row level security;
alter table public.radar_resources enable row level security;
alter table public.radar_beneficiaries enable row level security;
alter table public.radar_resource_matches enable row level security;
alter table public.radar_workflow_checks enable row level security;
alter table public.radar_ops_logs enable row level security;

create or replace function public.radar_is_staff()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

create or replace function public.radar_is_manager()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.radar_profiles
    where id = auth.uid() and role in ('manager', 'admin')
  );
$$;

create or replace function public.radar_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.radar_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles_read_own" on public.radar_profiles;
create policy "profiles_read_own" on public.radar_profiles
  for select using (id = auth.uid() or public.radar_is_admin());

drop policy if exists "profiles_insert_own" on public.radar_profiles;
create policy "profiles_insert_own" on public.radar_profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_admin" on public.radar_profiles;
create policy "profiles_update_admin" on public.radar_profiles
  for update using (id = auth.uid() or public.radar_is_admin());

drop policy if exists "resources_staff_read" on public.radar_resources;
create policy "resources_staff_read" on public.radar_resources
  for select using (public.radar_is_staff());

drop policy if exists "resources_manager_write" on public.radar_resources;
create policy "resources_manager_write" on public.radar_resources
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

drop policy if exists "beneficiaries_manager_read" on public.radar_beneficiaries;
create policy "beneficiaries_manager_read" on public.radar_beneficiaries
  for select using (public.radar_is_manager());

drop policy if exists "beneficiaries_manager_write" on public.radar_beneficiaries;
create policy "beneficiaries_manager_write" on public.radar_beneficiaries
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

drop policy if exists "matches_manager_all" on public.radar_resource_matches;
create policy "matches_manager_all" on public.radar_resource_matches
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

drop policy if exists "workflow_staff_read" on public.radar_workflow_checks;
create policy "workflow_staff_read" on public.radar_workflow_checks
  for select using (public.radar_is_staff());

drop policy if exists "workflow_manager_write" on public.radar_workflow_checks;
create policy "workflow_manager_write" on public.radar_workflow_checks
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

drop policy if exists "ops_logs_staff_read" on public.radar_ops_logs;
create policy "ops_logs_staff_read" on public.radar_ops_logs
  for select using (public.radar_is_staff());

drop policy if exists "ops_logs_staff_insert" on public.radar_ops_logs;
create policy "ops_logs_staff_insert" on public.radar_ops_logs
  for insert with check (public.radar_is_staff());
