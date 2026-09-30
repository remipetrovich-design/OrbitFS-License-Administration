-- Customer release-channel request form metadata.
-- License Manager remains authoritative for request state and review history.

alter table if exists public.release_channel_access_requests
  add column if not exists request_details jsonb not null default '{}'::jsonb;

create index if not exists release_channel_access_requests_pending_idx
  on public.release_channel_access_requests(channel,requested_at desc)
  where status='pending';
