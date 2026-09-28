alter table if exists public.release_channel_access_requests
  add column if not exists request_details jsonb not null default '{}'::jsonb;
