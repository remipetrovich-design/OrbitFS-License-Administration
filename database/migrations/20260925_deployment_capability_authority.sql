-- License Manager is the technical authority for deployment authorization.
-- Billing Store may publish customer-facing releases but must not own these switches.

alter table public.system_settings
  add column if not exists base_deployment_enabled boolean not null default true,
  add column if not exists update_deployment_enabled boolean not null default true,
  add column if not exists rollback_enabled boolean not null default true;
