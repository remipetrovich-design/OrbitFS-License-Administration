-- Allow the central Master Database System to register validated customer database packages.
-- Forward-only constraint update; existing package rows are preserved.

alter table database_packages
  drop constraint if exists database_packages_source_repo_check;

alter table database_packages
  add constraint database_packages_source_repo_check
  check (source_repo in (
    'lucaskerim123/Master-Database-System',
    'lucaskerim123/V1-vercel-base',
    'lucaskerim123/V1-vercel-engine',
    'remipetrovich-design/OrbitFS-Base-System',
    'remipetrovich-design/OrbitFS_Engine'
  ));
