-- Forward-only repair for legacy metadata that did not already contain
-- a license_policy object. The earlier migration remains immutable.

update public.licenses
set metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{license_policy}',
  coalesce(metadata->'license_policy','{}'::jsonb) || jsonb_build_object('max_installations',1),
  true
)
where metadata->'license_policy' is null
   or coalesce(metadata->'license_policy'->>'max_installations','') <> '1';
