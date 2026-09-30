begin;

create table if not exists official_api_connections (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  label text not null,
  base_url text not null,
  allowed_clients text[] not null default '{}',
  enabled boolean not null default true,
  priority integer not null default 100,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint official_api_connections_service_key_check check (service_key in ('license_manager','license_runtime')),
  constraint official_api_connections_priority_check check (priority between 0 and 10000),
  constraint official_api_connections_url_check check (
    base_url ~ '^https://([a-z0-9-]+[.])?incendiarynetworks[.]cc(/|$)'
    and (
      (service_key='license_manager' and base_url ~ '/api/v1$')
      or
      (service_key='license_runtime' and base_url ~ '/api/v1/license$')
    )
  ),
  unique(service_key,base_url)
);

create index if not exists official_api_connections_lookup_idx
  on official_api_connections(service_key,enabled,priority,updated_at desc);

insert into official_api_connections(service_key,label,base_url,allowed_clients,enabled,priority,settings)
values
 ('license_manager','Primary License Manager API','https://incendiarynetworks.cc/api/v1',array['billing_store','dev_panel','release_builder'],true,10,'{"timeout_ms":10000,"cache_seconds":30,"health_path":"/license/health","auth_mode":"managed_machine_key"}'::jsonb),
 ('license_runtime','Primary OrbitFS licence runtime API','https://incendiarynetworks.cc/api/v1/license',array['v1_base','v1_engine','billing_store'],true,10,'{"timeout_ms":8000,"cache_seconds":0,"health_path":"/health","auth_mode":"license_credential"}'::jsonb)
on conflict(service_key,base_url) do update set
 label=excluded.label,
 allowed_clients=excluded.allowed_clients,
 enabled=excluded.enabled,
 priority=excluded.priority,
 settings=official_api_connections.settings || excluded.settings,
 updated_at=now();

alter table official_api_connections enable row level security;

comment on table official_api_connections is 'License Manager authoritative registry of official OrbitFS API endpoints. Downstream systems may only select enabled exact registry URLs.';

commit;
