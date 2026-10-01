-- Global License Manager emergency lockdown.
-- When active, middleware blocks every normal application/API route.
-- Only lockdown status and the isolated recovery endpoint remain available.

alter table public.system_settings
  add column if not exists emergency_lockdown boolean not null default false,
  add column if not exists emergency_lockdown_message text not null default 'OrbitFS is temporarily locked by system administration. Access is currently unavailable.',
  add column if not exists emergency_lockdown_reason text,
  add column if not exists emergency_lockdown_at timestamptz,
  add column if not exists emergency_lockdown_by text;
