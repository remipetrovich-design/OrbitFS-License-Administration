-- Allow both OrbitFS GitHub systems to share the License Manager database
-- without sharing database-package identity or current-package state.
-- Forward-only repair. Existing package rows are preserved.

alter table database_packages
  drop constraint if exists database_packages_source_repo_check;

alter table database_packages
  add constraint database_packages_source_repo_check
  check (source_repo in (
    'lucaskerim123/V1-vercel-base',
    'lucaskerim123/V1-vercel-engine',
    'remipetrovich-design/OrbitFS-Base-System',
    'remipetrovich-design/OrbitFS_Engine'
  ));

alter table database_packages
  drop constraint if exists database_packages_component_database_schema_version_package_sha256_key;

alter table database_packages
  drop constraint if exists database_packages_source_package_unique;

alter table database_packages
  add constraint database_packages_source_package_unique
  unique(component,database_schema_version,package_sha256,source_repo,source_commit);

drop index if exists database_packages_one_current_component_idx;
drop index if exists database_packages_one_current_component_source_idx;

create unique index database_packages_one_current_component_source_idx
  on database_packages(component,source_repo)
  where status='current';

create index if not exists database_packages_source_history_idx
  on database_packages(source_repo,component,database_schema_version desc,created_at desc);
