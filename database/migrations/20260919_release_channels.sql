-- License Manager owns OrbitFS release-channel definitions.
create table if not exists public.release_channels (
  id uuid primary key default gen_random_uuid(),
  channel text not null unique,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  customer_visible boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_channels_name_check check (channel ~ '^[a-z0-9][a-z0-9_-]{0,31}$')
);

insert into public.release_channels(channel,label,description,enabled,customer_visible,sort_order)
values
 ('stable','Stable','Production releases for normal customers.',true,true,10),
 ('beta','Beta','Pre-release builds for assigned beta customers.',true,true,20),
 ('dev','Development','Development releases for explicitly assigned customers.',true,true,30)
on conflict(channel) do update
set label=excluded.label,description=excluded.description,sort_order=excluded.sort_order,updated_at=now();

insert into public.release_channels(channel,label,description,enabled,customer_visible,sort_order)
select distinct r.channel,initcap(replace(r.channel,'_',' ')),'Existing OrbitFS release channel.',true,true,100
from public.releases r
where r.channel is not null
on conflict(channel) do nothing;

alter table public.releases drop constraint if exists releases_channel_fkey;
alter table public.releases add constraint releases_channel_fkey
  foreign key(channel) references public.release_channels(channel);

create index if not exists release_channels_enabled_idx on public.release_channels(enabled,customer_visible,sort_order);

create or replace function touch_release_channels_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

drop trigger if exists release_channels_touch on public.release_channels;
create trigger release_channels_touch before update on public.release_channels
for each row execute function touch_release_channels_updated_at();
