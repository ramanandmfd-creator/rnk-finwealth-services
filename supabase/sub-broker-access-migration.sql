-- RNK FINWEALTH SERVICES CRM: multi-user Sub-Broker access migration
-- Run this entire file in Supabase SQL Editor for project ntwkkstlukpujxarxkgt.
-- Existing clients without an owner remain Admin-only until assigned to a Sub-Broker.

create table if not exists public.rnk_sub_brokers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sub_broker_name text not null,
  sub_broker_code text not null unique,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.rnk_clients
  add column if not exists sub_broker_user_id uuid references auth.users(id) on delete set null;

create index if not exists rnk_clients_sub_broker_user_id_idx
  on public.rnk_clients (sub_broker_user_id);

alter table public.rnk_sub_brokers enable row level security;

drop policy if exists "RNK admins manage sub brokers" on public.rnk_sub_brokers;
create policy "RNK admins manage sub brokers" on public.rnk_sub_brokers
  for all to authenticated
  using (public.rnk_is_admin())
  with check (public.rnk_is_admin());

drop policy if exists "Sub brokers read own profile" on public.rnk_sub_brokers;
create policy "Sub brokers read own profile" on public.rnk_sub_brokers
  for select to authenticated
  using (user_id = auth.uid() and active = true);

grant select, insert, update, delete on public.rnk_sub_brokers to authenticated;

-- Replace the previous Admin-only policies with Admin + row-owner policies.
drop policy if exists "RNK admin can read clients" on public.rnk_clients;
drop policy if exists "RNK admin can add clients" on public.rnk_clients;
drop policy if exists "RNK admin can update clients" on public.rnk_clients;
drop policy if exists "RNK admin can delete clients" on public.rnk_clients;
drop policy if exists "RNK users read permitted clients" on public.rnk_clients;
drop policy if exists "RNK users insert permitted clients" on public.rnk_clients;
drop policy if exists "RNK users update permitted clients" on public.rnk_clients;
drop policy if exists "RNK users delete permitted clients" on public.rnk_clients;

create policy "RNK users read permitted clients" on public.rnk_clients
  for select to authenticated
  using (public.rnk_is_admin() or sub_broker_user_id = auth.uid());

create policy "RNK users insert permitted clients" on public.rnk_clients
  for insert to authenticated
  with check (
    public.rnk_is_admin()
    or (
      sub_broker_user_id = auth.uid()
      and exists (
        select 1 from public.rnk_sub_brokers b
        where b.user_id = auth.uid() and b.active = true
      )
    )
  );

create policy "RNK users update permitted clients" on public.rnk_clients
  for update to authenticated
  using (public.rnk_is_admin() or sub_broker_user_id = auth.uid())
  with check (
    public.rnk_is_admin()
    or (
      sub_broker_user_id = auth.uid()
      and exists (
        select 1 from public.rnk_sub_brokers b
        where b.user_id = auth.uid() and b.active = true
      )
    )
  );

create policy "RNK users delete permitted clients" on public.rnk_clients
  for delete to authenticated
  using (public.rnk_is_admin() or sub_broker_user_id = auth.uid());

-- No public/anonymous access is granted. Do not expose service_role/secret keys in the browser.
