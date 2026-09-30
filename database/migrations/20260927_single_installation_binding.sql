-- OrbitFS licences bind to one installation at a time.
-- Customers may release that binding only when this authority switch is enabled.
alter table public.system_settings
  add column if not exists customer_self_unlock_enabled boolean not null default true;

-- max_installations is retained in metadata for compatibility, but the authority
-- now enforces one bound OrbitFS system regardless of legacy values.
update public.licenses
set metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{license_policy,max_installations}',
  '1'::jsonb,
  true
)
where metadata is null
   or coalesce((metadata->'license_policy'->>'max_installations')::int, 1) <> 1;
