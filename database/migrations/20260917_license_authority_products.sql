-- Canonical OrbitFS products used by Billing Store and OrbitFS Base.
insert into products(slug,name,description,status)
values
  ('orbitfs_base','OrbitFS Base','OrbitFS Base System licence','active'),
  ('orbitfs_apex','OrbitFS APEX','OrbitFS APEX addon licence','active'),
  ('orbitfs_mcp','OrbitFS MCP','OrbitFS MCP addon licence','active'),
  ('orbitfs_studio','OrbitFS Studio','OrbitFS Studio addon licence','active')
on conflict(slug) do update set name=excluded.name,description=excluded.description,status='active',updated_at=now();

create unique index if not exists licenses_external_reference_uidx
  on licenses(external_reference)
  where external_reference is not null and length(trim(external_reference)) > 0;
