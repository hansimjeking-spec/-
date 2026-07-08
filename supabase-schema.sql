-- Welfare Resource Radar Supabase schema
-- 1) Supabase SQL Editor에서 실행하세요.
-- 2) 실제 기관 공유 전에 RLS 정책을 기관 환경에 맞게 재검토하세요.
-- 3) service role key는 앱에 넣지 마세요. 브라우저에는 anon key만 사용합니다.

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

create or replace function public.radar_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.radar_lock_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role and not public.radar_is_admin() then
    raise exception 'Only admin can change radar profile role';
  end if;
  return new;
end;
$$;

drop trigger if exists radar_profiles_touch_updated_at on public.radar_profiles;
create trigger radar_profiles_touch_updated_at
  before update on public.radar_profiles
  for each row execute function public.radar_touch_updated_at();

drop trigger if exists radar_resources_touch_updated_at on public.radar_resources;
create trigger radar_resources_touch_updated_at
  before update on public.radar_resources
  for each row execute function public.radar_touch_updated_at();

drop trigger if exists radar_beneficiaries_touch_updated_at on public.radar_beneficiaries;
create trigger radar_beneficiaries_touch_updated_at
  before update on public.radar_beneficiaries
  for each row execute function public.radar_touch_updated_at();

drop trigger if exists radar_profiles_lock_role on public.radar_profiles;
create trigger radar_profiles_lock_role
  before update on public.radar_profiles
  for each row execute function public.radar_lock_profile_role();

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

-- 프로필: 본인은 자기 프로필을 만들고 읽을 수 있지만, role 변경은 트리거가 막습니다.
drop policy if exists "profiles_read_own_or_admin" on public.radar_profiles;
create policy "profiles_read_own_or_admin" on public.radar_profiles
  for select using (id = auth.uid() or public.radar_is_admin());

drop policy if exists "profiles_insert_own_staff" on public.radar_profiles;
create policy "profiles_insert_own_staff" on public.radar_profiles
  for insert with check (id = auth.uid() and role = 'staff');

drop policy if exists "profiles_update_own_no_role" on public.radar_profiles;
create policy "profiles_update_own_no_role" on public.radar_profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_admin_all" on public.radar_profiles;
create policy "profiles_admin_all" on public.radar_profiles
  for all using (public.radar_is_admin()) with check (public.radar_is_admin());

-- 자원: 직원은 조회, 담당자 이상은 등록·수정·삭제.
drop policy if exists "resources_staff_read" on public.radar_resources;
create policy "resources_staff_read" on public.radar_resources
  for select using (public.radar_is_staff());

drop policy if exists "resources_manager_write" on public.radar_resources;
create policy "resources_manager_write" on public.radar_resources
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

-- 대상자: 민감정보라 담당자 이상만 조회/수정.
drop policy if exists "beneficiaries_manager_read" on public.radar_beneficiaries;
create policy "beneficiaries_manager_read" on public.radar_beneficiaries
  for select using (public.radar_is_manager());

drop policy if exists "beneficiaries_manager_write" on public.radar_beneficiaries;
create policy "beneficiaries_manager_write" on public.radar_beneficiaries
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

-- 매칭 결과: 대상자와 연결되므로 담당자 이상만.
drop policy if exists "matches_manager_all" on public.radar_resource_matches;
create policy "matches_manager_all" on public.radar_resource_matches
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

-- 체크리스트: 직원은 조회, 담당자 이상은 수정.
drop policy if exists "workflow_staff_read" on public.radar_workflow_checks;
create policy "workflow_staff_read" on public.radar_workflow_checks
  for select using (public.radar_is_staff());

drop policy if exists "workflow_manager_write" on public.radar_workflow_checks;
create policy "workflow_manager_write" on public.radar_workflow_checks
  for all using (public.radar_is_manager()) with check (public.radar_is_manager());

-- 업무 로그: 로그인 직원은 조회/추가 가능.
drop policy if exists "ops_logs_staff_read" on public.radar_ops_logs;
create policy "ops_logs_staff_read" on public.radar_ops_logs
  for select using (public.radar_is_staff());

drop policy if exists "ops_logs_staff_insert" on public.radar_ops_logs;
create policy "ops_logs_staff_insert" on public.radar_ops_logs
  for insert with check (public.radar_is_staff());

-- 최초 관리자 지정용 SQL 예시
-- 1) Supabase Authentication에서 본인 이메일로 로그인한 뒤 user id를 확인합니다.
-- 2) SQL Editor에서 아래 형태로 1회 실행합니다.
-- insert into public.radar_profiles (id, display_name, role)
-- values ('본인-auth-user-id', '관리자 이름', 'admin')
-- on conflict (id) do update set role = 'admin', display_name = excluded.display_name;
