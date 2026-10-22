-- RNK FINWEALTH SERVICES — Insurance Customer CRM
-- Run in the SAME Supabase project as client-manager-schema.sql.
-- Admin-only access via the existing rnk_is_admin() helper; no public access.
create table if not exists public.rnk_insurance_customers (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  email text,
  address text,
  rc_number text,
  policy_number text,
  policy_start_date date,
  policy_end_date date,
  pan_number text,
  aadhaar_number text,
  nominee_name text,
  nominee_dob date,
  insurance_type text not null default 'Car'
    check (insurance_type in ('Car','Two-wheeler','Health','Commercial Vehicle','Travel','Other')),
  insurer text,
  remarks text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rnk_insurance_dates_valid check (
    policy_start_date is null or policy_end_date is null or policy_end_date >= policy_start_date
  )
);
create index if not exists rnk_insurance_customer_name_idx on public.rnk_insurance_customers(customer_name);
create index if not exists rnk_insurance_phone_idx on public.rnk_insurance_customers(phone);
create index if not exists rnk_insurance_policy_end_idx on public.rnk_insurance_customers(policy_end_date);
alter table public.rnk_insurance_customers enable row level security;
drop policy if exists "RNK admins read insurance customers" on public.rnk_insurance_customers;
create policy "RNK admins read insurance customers" on public.rnk_insurance_customers
  for select to authenticated using (public.rnk_is_admin());
drop policy if exists "RNK admins add insurance customers" on public.rnk_insurance_customers;
create policy "RNK admins add insurance customers" on public.rnk_insurance_customers
  for insert to authenticated with check (public.rnk_is_admin() and created_by = auth.uid());
drop policy if exists "RNK admins update insurance customers" on public.rnk_insurance_customers;
create policy "RNK admins update insurance customers" on public.rnk_insurance_customers
  for update to authenticated using (public.rnk_is_admin()) with check (public.rnk_is_admin());
drop policy if exists "RNK admins delete insurance customers" on public.rnk_insurance_customers;
create policy "RNK admins delete insurance customers" on public.rnk_insurance_customers
  for delete to authenticated using (public.rnk_is_admin());
grant select, insert, update, delete on public.rnk_insurance_customers to authenticated;
-- This table contains personal identifiers. Keep RLS enabled and do not expose secret/service_role keys.
