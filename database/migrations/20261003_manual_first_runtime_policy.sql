-- Manual-first runtime policy for the single-operator phase.
-- Successful licence state is cached for 90 minutes and pulse checks are also
-- 90 minutes unless an operator sends a manual recheck directive.

alter table public.system_settings
  alter column validation_ttl_seconds set default 5400,
  alter column pulse_poll_seconds set default 5400;

alter table public.system_settings
  drop constraint if exists system_settings_pulse_poll_seconds_check;
alter table public.system_settings
  add constraint system_settings_pulse_poll_seconds_check
  check (pulse_poll_seconds between 60 and 86400);

do $$
declare
  v_revision bigint;
begin
  update public.system_settings
     set validation_ttl_seconds=5400,
         pulse_poll_seconds=5400,
         pulse_revision=coalesce(pulse_revision,0)+1,
         pulse_at=now(),
         pulse_reason='manual-first-runtime-policy',
         updated_at=now()
   where id=true
  returning pulse_revision into v_revision;

  insert into public.audit_events(actor_user_id,actor,action,resource_type,details)
  values(
    null,
    'migration:20261003_manual_first_runtime_policy',
    'settings.runtime_policy',
    'system_settings',
    jsonb_build_object(
      'validation_ttl_seconds',5400,
      'pulse_poll_seconds',5400,
      'reason','manual_first_single_operator'
    )
  );

  if to_regclass('public.license_pulses') is not null then
    insert into public.license_pulses(
      revision,action,scope,reason,payload,requires_ack,created_by_user_id,created_by
    )
    values(
      v_revision,
      'refresh_runtime_policy',
      'global',
      'manual-first-runtime-policy',
      jsonb_build_object(
        'validation_ttl_seconds',5400,
        'pulse_poll_seconds',5400,
        'reason','manual_first_single_operator'
      ),
      true,
      null,
      'migration:20261003_manual_first_runtime_policy'
    );
  end if;
end $$;
