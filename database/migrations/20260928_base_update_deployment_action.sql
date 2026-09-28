alter table public.deployment_events
  drop constraint if exists deployment_events_action_check;
alter table public.deployment_events
  add constraint deployment_events_action_check
  check (action in ('check_in','deploy','base_update','update','redeploy','rollback'));
