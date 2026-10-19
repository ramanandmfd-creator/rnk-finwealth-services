-- RNK FINWEALTH SERVICES — Client Desk schema
-- Run in Supabase SQL Editor for the project you will use with this app.
-- Create the single admin in Authentication > Users first, then add their UUID below.

create extension if not exists pgcrypto;

create table if not exists public.rnk_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rnk_admins enable row level security;
-- Intentionally no direct policies on rnk_admins: only the security-definer helper reads it.

create or replace function public.rnk_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rnk_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.rnk_is_admin() from public;
grant execute on function public.rnk_is_admin() to authenticated;

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rnk_clients_name_idx on public.rnk_clients (client_name);
create index if not exists rnk_clients_call_date_idx on public.rnk_clients (next_call_date);
create index if not exists rnk_clients_tentative_date_idx on public.rnk_clients (tentative_investment_date);

alter table public.rnk_clients enable row level security;

drop policy if exists "RNK admin can read clients" on public.rnk_clients;
create policy "RNK admin can read clients" on public.rnk_clients
for select to authenticated using (public.rnk_is_admin());

drop policy if exists "RNK admin can add clients" on public.rnk_clients;
create policy "RNK admin can add clients" on public.rnk_clients
for insert to authenticated with check (public.rnk_is_admin());

drop policy if exists "RNK admin can update clients" on public.rnk_clients;
create policy "RNK admin can update clients" on public.rnk_clients
for update to authenticated using (public.rnk_is_admin()) with check (public.rnk_is_admin());

drop policy if exists "RNK admin can delete clients" on public.rnk_clients;
create policy "RNK admin can delete clients" on public.rnk_clients
for delete to authenticated using (public.rnk_is_admin());

grant select, insert, update, delete on public.rnk_clients to authenticated;

-- After creating your admin user in Supabase Authentication > Users:
-- replace ADMIN_AUTH_USER_UUID with that user's UUID and run:
-- insert into public.rnk_admins (user_id)
-- values ('ADMIN_AUTH_USER_UUID')
-- on conflict (user_id) do nothing;

-- IMPORTANT: Disable public sign-ups in Supabase Authentication settings.
-- Never put a service_role/secret key in this client-side app.


-- Add sub-broker identity fields to existing client records (safe to run on an existing CRM).
alter table public.rnk_clients
  add column if not exists sub_broker_name text,
  add column if not exists sub_broker_code text;

