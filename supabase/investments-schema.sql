-- RNK FINWEALTH SERVICES — Investment CRM table
-- Run this AFTER supabase/client-manager-schema.sql in the SAME Supabase project.
-- Uses the existing public.rnk_is_admin() helper and rnk_admins allowlist.
create table if not exists public.rnk_investments (
  id uuid primary key default gen_random_uuid(),
  investment_date date not null,
  client_name text not null,
  phone text not null,
  investment_amount numeric(16,2) not null check (investment_amount >= 0),
  maturity_date date not null,
  interest_rate numeric(7,4) check (interest_rate is null or (interest_rate >= 0 and interest_rate <= 100)),
  product text,
  folio text,
  status text not null default 'Active' check (status in ('Active','Matured','Renewed','Closed')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rnk_investment_dates_valid check (maturity_date >= investment_date)
);
create index if not exists rnk_investments_maturity_idx on public.rnk_investments(maturity_date);
create index if not exists rnk_investments_client_idx on public.rnk_investments(client_name);
alter table public.rnk_investments enable row level security;
drop policy if exists "RNK admin can read investments" on public.rnk_investments;
create policy "RNK admin can read investments" on public.rnk_investments for select to authenticated using (public.rnk_is_admin());
drop policy if exists "RNK admin can add investments" on public.rnk_investments;
create policy "RNK admin can add investments" on public.rnk_investments for insert to authenticated with check (public.rnk_is_admin() and created_by = auth.uid());
drop policy if exists "RNK admin can update investments" on public.rnk_investments;
create policy "RNK admin can update investments" on public.rnk_investments for update to authenticated using (public.rnk_is_admin()) with check (public.rnk_is_admin());
drop policy if exists "RNK admin can delete investments" on public.rnk_investments;
create policy "RNK admin can delete investments" on public.rnk_investments for delete to authenticated using (public.rnk_is_admin());
grant select, insert, update, delete on public.rnk_investments to authenticated;
-- Enable Supabase Realtime for cross-device updates.
do $$ begin
  alter publication supabase_realtime add table public.rnk_investments;
exception when duplicate_object then null;
when undefined_object then raise notice 'Realtime publication unavailable; enable Realtime for rnk_investments in Supabase Dashboard.';
end $$;
