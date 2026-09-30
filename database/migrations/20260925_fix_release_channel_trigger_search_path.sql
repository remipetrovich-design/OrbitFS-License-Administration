-- Migration automation probe plus security hardening.
-- The mapped License Manager project must already contain this trigger function.
do $$
begin
  if to_regprocedure('public.touch_release_channel_access_updated_at()') is null then
    raise exception 'Wrong database or incomplete License Manager schema: touch_release_channel_access_updated_at() is missing';
  end if;
end $$;

alter function public.touch_release_channel_access_updated_at() set search_path = public;
