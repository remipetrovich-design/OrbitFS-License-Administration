-- Canonical per-license release channel access.
-- Required by /api/v1/release-channels/access, updater eligibility and deployer authorization.

create table if not exists public.release_channel_access (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  channel text not null references public.release_channels(channel) on delete cascade,
  granted_by text,
  external_reference text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(license_id, channel)
);

create index if not exists release_channel_access_license_idx
  on public.release_channel_access(license_id, channel);
create index if not exists release_channel_access_expiry_idx
  on public.release_channel_access(channel, expires_at);

create or replace function touch_release_channel_access_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at=now();
  return new;
end $$;

drop trigger if exists release_channel_access_touch on public.release_channel_access;
create trigger release_channel_access_touch
before update on public.release_channel_access
for each row execute function touch_release_channel_access_updated_at();
