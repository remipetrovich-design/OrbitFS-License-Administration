-- Align installation records with the authoritative licence lifecycle.
-- active = licence is bound to this installation.
-- released = historical installation record; licence is unbound and may bind again.
-- Licence suspension/termination are licence-level states and no longer live on activations.

update public.licenses l
set status='suspended'
where l.status='active'
  and exists (
    select 1 from public.activations a
    where a.license_id=l.id and a.status='locked'
  );

alter table public.activations
  drop constraint if exists activations_status_check;

update public.activations set status='released' where status='terminated';
update public.activations set status='active' where status='locked';

alter table public.activations
  add constraint activations_status_check check (status in ('active','released'));

-- Preserve one currently bound installation per licence if legacy data somehow
-- contains duplicates. Older rows become released history.
with ranked as (
  select id,row_number() over(partition by license_id order by last_seen_at desc,id) rn
  from public.activations
  where status='active'
)
update public.activations a
set status='released'
from ranked r
where a.id=r.id and r.rn>1;
