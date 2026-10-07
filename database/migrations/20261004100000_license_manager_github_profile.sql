-- License Manager owns the MAIN/FALLBACK source-mode authority.
-- The switch is permitted only while system_enabled (Master Authority) is false.
alter table if exists system_settings
  add column if not exists github_profile text not null default 'fallback';

alter table if exists system_settings
  drop constraint if exists system_settings_github_profile_check;

alter table if exists system_settings
  add constraint system_settings_github_profile_check
  check (github_profile in ('primary','fallback'));
