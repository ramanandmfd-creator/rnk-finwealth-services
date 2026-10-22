-- RNK FINWEALTH SERVICES: Vehicle Insurance Details fields
-- Run once in Supabase SQL Editor. Existing customer records are preserved.
alter table public.rnk_insurance_customers
  add column if not exists vehicle_type text not null default 'Car',
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists chassis_number text,
  add column if not exists engine_number text,
  add column if not exists policy_type text not null default 'Comprehensive',
  add column if not exists sum_insured numeric(16,2);

create index if not exists rnk_insurance_vehicle_type_idx
  on public.rnk_insurance_customers (vehicle_type);
