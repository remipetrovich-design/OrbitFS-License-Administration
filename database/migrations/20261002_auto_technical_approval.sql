alter table if exists system_settings
  add column if not exists auto_technical_approval_enabled boolean not null default true;

update system_settings
set auto_technical_approval_enabled = true,
    updated_at = now()
where id = true;
