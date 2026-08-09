-- intake.ping() — a second connectivity marker, added deliberately.
--
-- `intake.health()` already proved the pipeline once, on the very first deploy. This one
-- exists to prove it again, on purpose, for a *new* migration going through the same path
-- a second time: CI's migration-scope guard, `supabase db push` on merge to main, and both
-- applications picking the change up on their next deploy without anyone touching a
-- dashboard.
--
-- Same security shape as intake.health(), because there is no reason for it to differ:
-- `security invoker` needs no privileges of its own, `set search_path = ''` and a fully
-- qualified literal avoid the unpinned search_path foot-gun. Reads nothing, holds nothing.
--
-- Returns a fixed string rather than a timestamp — deliberately a different shape from
-- health(), so a page rendering both is visibly two round trips rather than one value
-- shown twice.

create or replace function intake.ping()
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select 'pipeline-ok'::text;
$$;

comment on function intake.ping() is
  'A second connectivity marker, added to prove a new migration reaches production end
   to end. Reads no data.';

revoke all on function intake.ping() from public;
grant execute on function intake.ping() to anon, authenticated;
