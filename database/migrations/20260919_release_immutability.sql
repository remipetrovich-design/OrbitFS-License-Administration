-- Published release records are immutable. New builds for an existing version must create a new revision.
create or replace function prevent_published_release_mutation() returns trigger language plpgsql as $$
begin
  if old.status='published' then
    -- Published releases remain immutable, except an explicit withdrawal.
    -- Withdrawal only changes the public status from published to disabled.
    if new.status='disabled'
      and new.product_id is not distinct from old.product_id
      and new.channel is not distinct from old.channel
      and new.version is not distinct from old.version
      and new.release_type is not distinct from old.release_type
      and new.source_repo is not distinct from old.source_repo
      and new.source_ref is not distinct from old.source_ref
      and new.artifact_url is not distinct from old.artifact_url
      and new.checksum is not distinct from old.checksum
      and new.review_status is not distinct from old.review_status
      and new.deployment_status is not distinct from old.deployment_status
      and new.source_sha is not distinct from old.source_sha
      and new.artifact_name is not distinct from old.artifact_name
      and new.artifact_repo is not distinct from old.artifact_repo
      and new.artifact_run_id is not distinct from old.artifact_run_id
      and new.vercel_ready is not distinct from old.vercel_ready
      and new.supabase_ready is not distinct from old.supabase_ready
      and new.customer_publication_repo is not distinct from old.customer_publication_repo
      and new.notes is not distinct from old.notes
      and new.manifest is not distinct from old.manifest
      and new.revision is not distinct from old.revision
      and new.supersedes_release_id is not distinct from old.supersedes_release_id
      and new.published_at is not distinct from old.published_at then
      return new;
    end if;
    if new.product_id is distinct from old.product_id
      or new.channel is distinct from old.channel
      or new.version is distinct from old.version
      or new.release_type is distinct from old.release_type
      or new.source_repo is distinct from old.source_repo
      or new.source_ref is distinct from old.source_ref
      or new.artifact_url is distinct from old.artifact_url
      or new.checksum is distinct from old.checksum
      or new.status is distinct from old.status
      or new.review_status is distinct from old.review_status
      or new.deployment_status is distinct from old.deployment_status
      or new.source_sha is distinct from old.source_sha
      or new.artifact_name is distinct from old.artifact_name
      or new.artifact_repo is distinct from old.artifact_repo
      or new.artifact_run_id is distinct from old.artifact_run_id
      or new.vercel_ready is distinct from old.vercel_ready
      or new.supabase_ready is distinct from old.supabase_ready
      or new.customer_publication_repo is distinct from old.customer_publication_repo
      or new.notes is distinct from old.notes
      or new.manifest is distinct from old.manifest
      or new.revision is distinct from old.revision
      or new.supersedes_release_id is distinct from old.supersedes_release_id
      or new.published_at is distinct from old.published_at then
      raise exception 'Published releases are immutable; create a new revision';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists releases_immutable_published on public.releases;
create trigger releases_immutable_published before update on public.releases for each row execute function prevent_published_release_mutation();
