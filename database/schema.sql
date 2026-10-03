create extension if not exists pgcrypto;

create table if not exists system_settings (
  id boolean primary key default true,
  system_name text not null default 'License Manager',
  github_profile text not null default 'fallback' check(github_profile in ('primary','fallback')),
  system_enabled boolean not null default true,
  licensing_enabled boolean not null default true,
  maintenance_mode boolean not null default false,
  customer_self_unlock_enabled boolean not null default true,
  release_system_enabled boolean not null default true,
  auto_technical_approval_enabled boolean not null default true,
  deployment_enabled boolean not null default true,
  validation_ttl_seconds integer not null default 5400,
  offline_grace_seconds integer not null default 0,
  pulse_poll_seconds integer not null default 5400,
  max_failed_validations integer not null default 3,
  allow_offline_grace boolean not null default false,
  pulse_revision bigint not null default 1,
  pulse_at timestamptz not null default now(),
  pulse_reason text not null default 'initial',
  updated_at timestamptz not null default now(),
  check (id = true)
);
insert into system_settings(id) values(true) on conflict do nothing;

create table if not exists users (
  id uuid primary key default gen_random_uuid(), email text unique not null, password_hash text not null, password_salt text not null,
  display_name text not null, role text not null default 'admin' check(role in ('owner','admin','operator','viewer')),
  status text not null default 'active' check(status in ('active','disabled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_login_at timestamptz
);
create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, token_hash text unique not null,
  expires_at timestamptz not null, created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), user_agent text, ip_address text
);
create table if not exists products (
  id uuid primary key default gen_random_uuid(), slug text unique not null check(slug ~ '^[a-z0-9][a-z0-9._-]*$'), name text not null, description text,
  status text not null default 'active' check(status in ('active','disabled','archived')), validation_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists licenses (
  id uuid primary key default gen_random_uuid(), license_key_hash text unique not null, license_key_last4 text not null,
  product_id uuid not null references products(id), customer_external_id text, customer_override boolean not null default false, external_reference text,
  status text not null default 'active' check(status in ('pending','active','suspended','revoked','expired')), issued_at timestamptz not null default now(), expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(expires_at is null or expires_at > issued_at)
);
create table if not exists activations (
  id uuid primary key default gen_random_uuid(), license_id uuid not null references licenses(id) on delete cascade, installation_id text not null,
  product_version text, status text not null default 'active' check(status in ('active','released')), last_seen_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(), last_ip text, last_user_agent text, last_hostname text, last_platform text, last_architecture text,
  last_client text, last_client_version text, last_provider text, last_region text, last_deployment_id text, last_deployment_url text,
  last_deployment_status text, last_operation text, deployment_count integer not null default 0, current_components jsonb not null default '{}'::jsonb,
  unique(license_id, installation_id)
);
create table if not exists releases (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references products(id), channel text not null default 'stable' check(channel ~ '^[a-z0-9][a-z0-9._-]*$'), version text not null,
  release_type text not null check(release_type in ('base','update')), source_repo text, source_ref text, artifact_url text, checksum text,
  status text not null default 'draft' check(status in ('draft','published','disabled','superseded','withdrawn')), review_status text not null default 'pending' check(review_status in ('pending','approved','rejected')),
  deployment_status text not null default 'not_started' check(deployment_status in ('not_started','queued','deploying','deployed','failed')),
  source_sha text, artifact_name text, artifact_repo text, artifact_run_id bigint, vercel_ready boolean not null default false, supabase_ready boolean not null default false,
  customer_publication_repo text, notes text, manifest jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), published_at timestamptz,
  revision integer not null default 1, supersedes_release_id uuid references releases(id) on delete set null, archived_at timestamptz, archived_by uuid references users(id) on delete set null
);
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(), name text not null, key_hash text unique not null, key_last4 text not null,
  scopes jsonb not null default '[]'::jsonb, status text not null default 'active' check(status in ('active','revoked')),
  created_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz, revoked_by uuid references users(id) on delete set null
);
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid references users(id) on delete set null, actor text not null, action text not null,
  resource_type text, resource_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists users_status_idx on users(status);create index if not exists sessions_user_idx on user_sessions(user_id);create index if not exists sessions_expiry_idx on user_sessions(expires_at);create index if not exists licenses_product_idx on licenses(product_id);create index if not exists licenses_customer_idx on licenses(customer_external_id);create index if not exists licenses_status_idx on licenses(status);create index if not exists licenses_override_idx on licenses(customer_override);create index if not exists activations_license_idx on activations(license_id);create index if not exists activations_status_idx on activations(status);create index if not exists activations_seen_idx on activations(last_seen_at desc);create index if not exists releases_product_idx on releases(product_id);create index if not exists releases_lookup_idx on releases(product_id,channel,status,release_type);create index if not exists releases_review_idx on releases(review_status,release_type,created_at desc);create index if not exists api_keys_status_idx on api_keys(status);create index if not exists audit_created_idx on audit_events(created_at desc);
create or replace function touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists users_touch on users;create trigger users_touch before update on users for each row execute function touch_updated_at();drop trigger if exists products_touch on products;create trigger products_touch before update on products for each row execute function touch_updated_at();drop trigger if exists licenses_touch on licenses;create trigger licenses_touch before update on licenses for each row execute function touch_updated_at();
alter table releases add column if not exists manifest jsonb not null default '{}'::jsonb;
alter table system_settings add column if not exists github_profile text not null default 'fallback';
alter table system_settings drop constraint if exists system_settings_github_profile_check;
alter table system_settings add constraint system_settings_github_profile_check check(github_profile in ('primary','fallback'));
alter table system_settings add column if not exists release_system_enabled boolean not null default true;
alter table system_settings add column if not exists auto_technical_approval_enabled boolean not null default true;
alter table system_settings add column if not exists deployment_enabled boolean not null default true;
alter table system_settings add column if not exists validation_ttl_seconds integer not null default 5400;
alter table system_settings add column if not exists offline_grace_seconds integer not null default 0;
alter table system_settings add column if not exists pulse_poll_seconds integer not null default 5400;
alter table system_settings add column if not exists max_failed_validations integer not null default 3;
alter table system_settings add column if not exists allow_offline_grace boolean not null default false;
alter table system_settings add column if not exists pulse_revision bigint not null default 1;
alter table system_settings add column if not exists pulse_at timestamptz not null default now();
alter table system_settings add column if not exists pulse_reason text not null default 'initial';
alter table user_sessions add column if not exists user_agent text;
alter table user_sessions add column if not exists ip_address text;
alter table licenses add column if not exists external_reference text;
alter table licenses add column if not exists customer_override boolean not null default false;
alter table activations add column if not exists status text not null default 'active';
alter table releases add column if not exists checksum text;
alter table releases add column if not exists published_at timestamptz;
alter table releases add column if not exists review_status text not null default 'pending';
alter table releases add column if not exists deployment_status text not null default 'not_started';
alter table releases add column if not exists source_sha text;
alter table releases add column if not exists artifact_name text;
alter table releases add column if not exists artifact_repo text;
alter table releases add column if not exists artifact_run_id bigint;
alter table releases add column if not exists vercel_ready boolean not null default false;
alter table releases add column if not exists supabase_ready boolean not null default false;
alter table releases add column if not exists customer_publication_repo text;
alter table audit_events add column if not exists actor_user_id uuid references users(id) on delete set null;

create table if not exists release_channels (
  id uuid primary key default gen_random_uuid(),
  channel text not null unique,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  customer_visible boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_channels_name_check check(channel ~ '^[a-z0-9][a-z0-9_-]{0,31}$')
);
insert into release_channels(channel,label,description,sort_order) values
 ('stable','Stable','Production releases for normal customers.',10),
 ('beta','Beta','Pre-release builds for assigned beta customers.',20),
 ('dev','Development','Development releases for explicitly assigned customers.',30)
on conflict(channel) do nothing;
alter table releases drop constraint if exists releases_channel_fkey;
alter table releases add constraint releases_channel_fkey foreign key(channel) references release_channels(channel);
create index if not exists release_channels_enabled_idx on release_channels(enabled,customer_visible,sort_order);

create table if not exists release_channel_access (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  channel text not null references release_channels(channel) on delete cascade,
  granted_by text,
  external_reference text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(license_id, channel)
);
create index if not exists release_channel_access_license_idx on release_channel_access(license_id,channel);
create index if not exists release_channel_access_expiry_idx on release_channel_access(channel,expires_at);

create table if not exists release_channel_access_requests (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  channel text not null references release_channels(channel) on delete cascade,
  external_reference text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  reason text,
  unique(license_id,channel,status)
);
create index if not exists release_channel_access_requests_channel_status_idx on release_channel_access_requests(channel,status,requested_at desc);
create index if not exists release_channel_access_requests_license_idx on release_channel_access_requests(license_id,status,requested_at desc);

create table if not exists deployment_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid references licenses(id) on delete set null,
  activation_id uuid references activations(id) on delete set null,
  installation_id text,
  release_id uuid references releases(id) on delete set null,
  action text not null check(action in ('check_in','deploy','base_update','update','redeploy','rollback')),
  phase text not null check(phase in ('authorize','started','completed','failed')),
  product text,
  product_version text,
  previous_version text,
  deployment_id text,
  deployment_url text,
  project_id text,
  project_name text,
  provider text,
  region text,
  platform text,
  architecture text,
  hostname text,
  client text,
  client_version text,
  source_ip text,
  user_agent text,
  customer_identity jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists deployment_events_installation_idx on deployment_events(installation_id,created_at desc);
create index if not exists deployment_events_license_idx on deployment_events(license_id,created_at desc);create index if not exists deployment_events_activation_idx on deployment_events(activation_id,created_at desc);
create index if not exists deployment_events_release_idx on deployment_events(release_id,created_at desc);
create index if not exists deployment_events_deployment_idx on deployment_events(deployment_id);
alter table activations add column if not exists first_seen_at timestamptz not null default now();
alter table activations add column if not exists last_ip text;
alter table activations add column if not exists last_user_agent text;
alter table activations add column if not exists last_hostname text;
alter table activations add column if not exists last_platform text;
alter table activations add column if not exists last_architecture text;
alter table activations add column if not exists last_client text;
alter table activations add column if not exists last_client_version text;
alter table activations add column if not exists last_provider text;
alter table activations add column if not exists last_region text;
alter table activations add column if not exists last_deployment_id text;
alter table activations add column if not exists last_deployment_url text;
alter table activations add column if not exists last_deployment_status text;
alter table activations add column if not exists last_operation text;
alter table activations add column if not exists deployment_count integer not null default 0;
alter table activations add column if not exists current_components jsonb not null default '{}'::jsonb;


-- Targeted licence pulse protocol. system_settings.pulse_revision remains the
-- compatibility high-water mark; clients can consume scoped directives below.
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
