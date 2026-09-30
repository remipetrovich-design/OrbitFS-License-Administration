-- Repair release-channel access policy schema after the legacy migration attempted
-- to normalize access_mode before dropping the previous constraint.
-- License Manager remains authoritative for channel definitions and access policy.

alter table public.release_channels
  drop constraint if exists release_channels_access_mode_check;

alter table public.release_channels
  add column if not exists access_request_enabled boolean not null default false,
  add column if not exists self_join_enabled boolean not null default false;

update public.release_channels
set access_mode = case
  when channel='stable' or access_mode in ('all','open') then 'open'
  else 'closed'
end;

update public.release_channels
set access_request_enabled=true
where channel='beta';

update public.release_channels
set self_join_enabled=false
where channel<>'stable';

alter table public.release_channels
  add constraint release_channels_access_mode_check
  check (access_mode in ('open','closed'));

create index if not exists release_channels_access_idx
  on public.release_channels(enabled,access_mode,sort_order);

create index if not exists release_channels_customer_access_idx
  on public.release_channels(enabled,customer_visible,access_mode,access_request_enabled,self_join_enabled);

create table if not exists public.release_channel_access_requests (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null,
  channel text not null references public.release_channels(channel) on delete cascade,
  external_reference text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  reason text,
  unique(license_id,channel,status)
);

create index if not exists release_channel_access_requests_channel_status_idx
  on public.release_channel_access_requests(channel,status,requested_at desc);

create index if not exists release_channel_access_requests_license_idx
  on public.release_channel_access_requests(license_id,status,requested_at desc);
