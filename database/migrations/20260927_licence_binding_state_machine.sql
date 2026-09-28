alter table public.activations
  drop constraint if exists activations_status_check;
update public.activations set status='released' where status='terminated';
update public.activations set status='active' where status='locked';
alter table public.activations
  add constraint activations_status_check check (status in ('active','released'));
