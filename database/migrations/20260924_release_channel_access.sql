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
