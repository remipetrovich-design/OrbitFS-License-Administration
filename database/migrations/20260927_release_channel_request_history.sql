-- Allow customers to request the same restricted release channel again after
-- a previous request was approved, rejected or cancelled.
-- Only one pending request may exist per licence/channel at a time.

alter table if exists public.release_channel_access_requests
  drop constraint if exists release_channel_access_requests_license_id_channel_status_key;

create unique index if not exists release_channel_access_requests_one_pending_idx
  on public.release_channel_access_requests(license_id,channel)
  where status='pending';
