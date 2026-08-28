-- The audit trail can record both of the actions added on 28 August 2026.
--
-- ---------------------------------------------------------------------------------------
-- Why this migration exists, and why it is not a mistake in either branch
-- ---------------------------------------------------------------------------------------
-- `entries.admin_audit.action` is a **closed list**, deliberately: every action the admin
-- surface can take has to arrive in a diff somebody approved, exactly as a fee code does. The
-- way a closed list is widened here is `drop constraint if exists` followed by
-- `add constraint` with the full list restated.
--
-- **Restating the full list is what makes two branches collide.** Two changes were in flight
-- on the same day and neither could see the other's value:
--
--   * `20260828141000_entries_complimentary_places.sql` added `create_manual_entry`, for the
--     place a volunteer gives — ADR-021;
--   * `20260828190000_entries_admin_outbox.sql` added `resend_email`, for the message a
--     volunteer sends again — #133.
--
-- Each wrote out the list as it stood on its own branch. The second to be applied wins
-- outright, so after both, `create_manual_entry` is missing and **every attempt to give a
-- place fails on the audit row it writes before writing the entry**. The transaction rolls
-- back, so nothing is half-created — the failure direction is right — but the feature is
-- simply dead, and nothing about the error says why.
--
-- **Neither migration is wrong and neither should be edited.** Both are applied; editing an
-- applied migration changes what a fresh `db reset` produces without changing what any
-- existing database holds, which is how two environments start disagreeing. This is the
-- third statement of the list, containing both.
--
-- ---------------------------------------------------------------------------------------
-- The general lesson, because this will happen again
-- ---------------------------------------------------------------------------------------
-- **A restated closed list is a merge conflict that git cannot see.** Two branches touching
-- `fees_code_check`, `entry_purchases_status_check` or this one will merge cleanly, pass
-- review, and silently drop whichever value was added by the branch that landed first.
--
-- What caught it here was a test that exercises the *behaviour* rather than the constraint:
-- `packages/db/tests/entries-manual-entry.test.ts` gives a place and asserts it exists. A test
-- asserting the constraint's own text would have needed the same restating and would have gone
-- stale in exactly the same way.
--
-- Expand only: this widens and removes nothing, so every previously deployed code path is
-- unaffected and both deploy orders are safe.

alter table entries.admin_audit
  drop constraint if exists admin_audit_action_check;

alter table entries.admin_audit
  add constraint admin_audit_action_check
  check (
    action in (
      'sign_in',
      'medical_note',
      'medical_export',
      'export',
      'cancel_entry',
      'transfer_entry',
      -- #133's, for a message sent again from `/admin/emails/`.
      'resend_email',
      -- ADR-021's, for a place given at no charge from `/admin/nn/`.
      'create_manual_entry'
    )
  );

comment on constraint admin_audit_action_check on entries.admin_audit is
  'Every action the admin surface may record, as a closed list so a new one arrives in a reviewed diff. Restated in full by each migration that widens it — which is why two branches adding a value on the same day silently drop one, and why this third statement exists.';
