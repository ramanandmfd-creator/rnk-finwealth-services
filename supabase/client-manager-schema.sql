-- RNK FINWEALTH SERVICES — Client Desk schema and secure Sub-Broker access
-- Safe to run in Supabase SQL Editor on an existing CRM. Existing client records are preserved.
create extension if not exists pgcrypto;

create table if not exists public.rnk_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.rnk_admins enable row level security;

create or replace function public.rnk_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.rnk_admins a where a.user_id = auth.uid()); $$;
revoke all on function public.rnk_is_admin() from public;
grant execute on function public.rnk_is_admin() to authenticated;

create table if not exists public.rnk_sub_brokers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sub_broker_name text not null,
  sub_broker_code text not null unique,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.rnk_sub_brokers enable row level security;

create or replace function public.rnk_is_active_sub_broker()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (
  select 1 from public.rnk_sub_brokers b
  where b.user_id = auth.uid() and b.active = true
); $$;
revoke all on function public.rnk_is_active_sub_broker() from public;
grant execute on function public.rnk_is_active_sub_broker() to authenticated;

create table if not exists public.rnk_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  phone text not null,
  record_date date,
  address text,
  source text,
  expected_amount numeric(16,2) check (expected_amount is null or expected_amount >= 0),
  scheme_name text,
  investment_date date,
  tentative_investment_date date,
  followup_status text not null default 'Pending'
    check (followup_status in ('Pending','Interested','Invested','Not Interested')),
  next_call_date date,
  call_time time,
  call_note text,
  remarks text,
  sub_broker_name text,
  sub_broker_code text,
  sub_broker_user_id uuid references public.rnk_sub_brokers(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rnk_clients
  add column if not exists sub_broker_name text,
  add column if not exists sub_broker_code text,
  add column if not exists sub_broker_user_id uuid references public.rnk_sub_brokers(user_id) on delete set null;

create index if not exists rnk_clients_name_idx on public.rnk_clients (client_name);
create index if not exists rnk_clients_call_date_idx on public.rnk_clients (next_call_date);
create index if not exists rnk_clients_tentative_date_idx on public.rnk_clients (tentative_investment_date);
create index if not exists rnk_clients_broker_user_idx on public.rnk_clients (sub_broker_user_id);

-- Remove old admin-only client policies and install role-aware RLS.
alter table public.rnk_clients enable row level security;
drop policy if exists "RNK admin can read clients" on public.rnk_clients;
drop policy if exists "RNK admin can add clients" on public.rnk_clients;
drop policy if exists "RNK admin can update clients" on public.rnk_clients;
drop policy if exists "RNK admin can delete clients" on public.rnk_clients;
drop policy if exists "RNK roles read assigned clients" on public.rnk_clients;
create policy "RNK roles read assigned clients" on public.rnk_clients
for select to authenticated using (public.rnk_is_admin() or sub_broker_user_id = auth.uid());

drop policy if exists "RNK roles add assigned clients" on public.rnk_clients;
create policy "RNK roles add assigned clients" on public.rnk_clients
for insert to authenticated with check (
  public.rnk_is_admin() or
  (public.rnk_is_active_sub_broker() and sub_broker_user_id = auth.uid())
);

drop policy if exists "RNK roles update assigned clients" on public.rnk_clients;
create policy "RNK roles update assigned clients" on public.rnk_clients
for update to authenticated using (public.rnk_is_admin() or sub_broker_user_id = auth.uid())
with check (
  public.rnk_is_admin() or
  (public.rnk_is_active_sub_broker() and sub_broker_user_id = auth.uid())
);

drop policy if exists "RNK roles delete assigned clients" on public.rnk_clients;
create policy "RNK roles delete assigned clients" on public.rnk_clients
for delete to authenticated using (public.rnk_is_admin() or sub_broker_user_id = auth.uid());

grant select, insert, update, delete on public.rnk_clients to authenticated;
revoke all on public.rnk_sub_brokers from anon;
grant select on public.rnk_sub_brokers to authenticated;

drop policy if exists "RNK admin manage sub brokers" on public.rnk_sub_brokers;
create policy "RNK admin manage sub brokers" on public.rnk_sub_brokers
for all to authenticated using (public.rnk_is_admin()) with check (public.rnk_is_admin());

drop policy if exists "RNK broker read own profile" on public.rnk_sub_brokers;
create policy "RNK broker read own profile" on public.rnk_sub_brokers
for select to authenticated using (user_id = auth.uid() and active = true);

-- Existing admin account: add its auth.users UUID to rnk_admins.
-- Do not enable public sign-ups. Never expose a service_role/secret key in the browser.
