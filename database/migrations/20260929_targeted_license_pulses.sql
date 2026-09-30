-- Targeted licence pulse directives and client receipts.
-- pulse_revision remains the compatibility high-water mark in system_settings.
-- New clients query applicable directives since their last applied revision.

create table if not exists license_pulses (
  id uuid primary key default gen_random_uuid(),
  revision bigint not null unique,
  action text not null,
  scope text not null default 'global' check(scope in ('global','product','license','installation','component')),
  license_id uuid,
  installation_id text,
  product text,
  component text,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  requires_ack boolean not null default true,
  created_by_user_id uuid references users(id) on delete set null,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists license_pulses_revision_idx on license_pulses(revision);
create index if not exists license_pulses_license_idx on license_pulses(license_id,revision);
create index if not exists license_pulses_installation_idx on license_pulses(installation_id,revision);
create index if not exists license_pulses_product_idx on license_pulses(product,revision);
create index if not exists license_pulses_component_idx on license_pulses(component,revision);

create table if not exists license_pulse_receipts (
  id uuid primary key default gen_random_uuid(),
  pulse_id uuid not null references license_pulses(id) on delete cascade,
  license_id uuid,
  installation_id text not null,
  client text,
  client_version text,
  status text not null check(status in ('received','applied','failed')),
  result_code text,
  error text,
  resulting_license_state text,
  resulting_revision bigint,
  details jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(pulse_id,installation_id)
);

create index if not exists license_pulse_receipts_pulse_idx on license_pulse_receipts(pulse_id,status);
create index if not exists license_pulse_receipts_installation_idx on license_pulse_receipts(installation_id,updated_at desc);
