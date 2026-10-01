-- Central customer database package registry.
-- Stores only approved customer-facing schema packages from Base/Engine source repos.
create extension if not exists pgcrypto;

create table if not exists database_packages (
  id uuid primary key default gen_random_uuid(),
  component text not null check(component in ('base','engine-shared','mcp','apex','studio')),
  database_target text not null default 'customer' check(database_target = 'customer'),
  source_repo text not null check(source_repo in ('lucaskerim123/V1-vercel-base','lucaskerim123/V1-vercel-engine')),
  source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
  database_schema_version integer not null check(database_schema_version > 0),
  minimum_base_schema_version integer check(minimum_base_schema_version is null or minimum_base_schema_version > 0),
  minimum_base_version text,
  package_sha256 text not null check(package_sha256 ~ '^[a-f0-9]{64}$'),
  package jsonb not null,
  status text not null default 'candidate' check(status in ('candidate','current','superseded','disabled')),
  created_by text not null,
  published_by text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  superseded_at timestamptz,
  unique(component,database_schema_version,package_sha256)
);

create unique index if not exists database_packages_one_current_component_idx
  on database_packages(component)
  where status='current';

create index if not exists database_packages_component_history_idx
  on database_packages(component,database_schema_version desc,created_at desc);

create index if not exists database_packages_status_idx
  on database_packages(status,created_at desc);

create or replace function protect_published_database_package()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('current','superseded') and (
    new.component is distinct from old.component
    or new.database_target is distinct from old.database_target
    or new.source_repo is distinct from old.source_repo
    or new.source_commit is distinct from old.source_commit
    or new.database_schema_version is distinct from old.database_schema_version
    or new.minimum_base_schema_version is distinct from old.minimum_base_schema_version
    or new.minimum_base_version is distinct from old.minimum_base_version
    or new.package_sha256 is distinct from old.package_sha256
    or new.package is distinct from old.package
  ) then
    raise exception 'published database package payload is immutable';
  end if;
  return new;
end
$$;

drop trigger if exists database_packages_immutable_payload on database_packages;
create trigger database_packages_immutable_payload
before update on database_packages
for each row execute function protect_published_database_package();
