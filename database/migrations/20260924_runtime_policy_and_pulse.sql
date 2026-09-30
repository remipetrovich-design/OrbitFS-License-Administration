-- Authoritative runtime validation policy and pulse revision.
-- Clients use pulse_revision to invalidate cached validation/enforcement state.

alter table system_settings add column if not exists validation_ttl_seconds integer not null default 60;
alter table system_settings add column if not exists offline_grace_seconds integer not null default 0;
alter table system_settings add column if not exists pulse_poll_seconds integer not null default 15;
alter table system_settings add column if not exists max_failed_validations integer not null default 3;
alter table system_settings add column if not exists allow_offline_grace boolean not null default false;
alter table system_settings add column if not exists pulse_revision bigint not null default 1;
alter table system_settings add column if not exists pulse_at timestamptz not null default now();
alter table system_settings add column if not exists pulse_reason text not null default 'initial';

alter table system_settings drop constraint if exists system_settings_validation_ttl_seconds_check;
alter table system_settings add constraint system_settings_validation_ttl_seconds_check check(validation_ttl_seconds between 5 and 86400);
alter table system_settings drop constraint if exists system_settings_offline_grace_seconds_check;
alter table system_settings add constraint system_settings_offline_grace_seconds_check check(offline_grace_seconds between 0 and 604800);
alter table system_settings drop constraint if exists system_settings_pulse_poll_seconds_check;
alter table system_settings add constraint system_settings_pulse_poll_seconds_check check(pulse_poll_seconds between 5 and 3600);
alter table system_settings drop constraint if exists system_settings_max_failed_validations_check;
alter table system_settings add constraint system_settings_max_failed_validations_check check(max_failed_validations between 1 and 100);

update system_settings
set offline_grace_seconds=0
where allow_offline_grace=false and offline_grace_seconds<>0;
