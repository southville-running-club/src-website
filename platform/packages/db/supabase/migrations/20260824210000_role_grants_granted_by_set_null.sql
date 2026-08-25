-- `identity.role_grants.granted_by` had no `on delete` action, discovered while building
-- #54: `identity.test.ts`'s own cleanup deletes a super-admin whose grant of `nn-admin` to
-- another person is still on record, and Postgres refuses — the super-admin's `identity.people`
-- row cannot be removed while a `role_grants` row still names them as the granter.
--
-- That is not only a test-cleanup problem. It means #62's eventual account-deletion function
-- would refuse to delete **any** account that has ever granted somebody else a role, which is
-- exactly the account most likely to have done so.
--
-- `on delete set null` is the right shape, not `cascade`: deleting the person who granted a
-- role should not un-grant it from whoever received it. The grant is kept; only who granted it
-- is forgotten — the same trade `identity.audit.actor` already makes, and for the same reason.
alter table identity.role_grants
  drop constraint role_grants_granted_by_fkey,
  add constraint role_grants_granted_by_fkey
    foreign key (granted_by) references identity.people (id) on delete set null;
