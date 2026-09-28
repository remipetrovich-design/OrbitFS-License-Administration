alter table public.system_settings
  add column if not exists customer_self_unlock_enabled boolean not null default true;

update public.licenses
set metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{license_policy,max_installations}',
  '1'::jsonb,
  true
)
where metadata is null
   or coalesce((metadata->'license_policy'->>'max_installations')::int, 1) <> 1;
