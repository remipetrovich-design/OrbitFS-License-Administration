update public.licenses
set metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{license_policy}',
  coalesce(metadata->'license_policy','{}'::jsonb) || jsonb_build_object('max_installations',1),
  true
)
where metadata->'license_policy' is null
   or coalesce(metadata->'license_policy'->>'max_installations','') <> '1';
