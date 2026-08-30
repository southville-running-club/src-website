# Dropping the England Athletics columns — the contract step

**One migration, written once, after the build that stopped collecting has been deployed.** It
removes `entries.entrants.ea_number`, `entries.fees.requires_ea_number`, the keys the two reads
still emit, and **two** of `transfer_entry()`'s three forms — see step 3, which grew on
30 August 2026 when [ADR-025](../../architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md)
added a phone number and had to carry `p_ea_number` past it.

**Nothing is broken until it is done, and nothing breaks if it is never done.** This is the
second half of a deliberate two-step, exactly as
[validating the entries constraints](entries-constraints.md) is — not a repair, and not urgent.
The club already asks for no number and holds none; what is left is dead weight.

Reasoning:
[ADR-023](../../architecture/decisions/adr-023-no-england-athletics-numbers.md), and
[`20260829120000_entries_no_ea_numbers.sql`](../../../platform/packages/db/supabase/migrations/20260829120000_entries_no_ea_numbers.sql),
which is the expand step this contracts.

---

## Why there is a second step at all

**Nothing sequences a migration against the Cloudflare deploy.** `db push` runs first and the
Worker follows some minutes later, so for those minutes the new schema is being read by the
Worker built before it.

That Worker's `entryShape` in `packages/shared/src/admin.ts` parses `ea_number` and
`requires_ea_number` as **required** nullable keys. Zod treats a missing key as a parse failure
rather than as a null — so dropping the columns in the same change that stopped using them would
have taken the whole of `/admin/nn/` down mid-deploy, and the England Athletics export with it.
A volunteer would have met a broken back office with nothing saying why, on a deploy whose
purpose was to collect *less*.

So the expand step emptied the columns instead: null on every entrant, false on every fee, both
keys still emitted, and two check constraints making it impossible to write either one again. A
Worker from **either** side of the deploy reads a well-formed answer.

**This runbook is the other side.** Once the build that stopped reading the keys is live, the
columns can go.

---

## Step 0 — before you start

- [ ] `20260829120000_entries_no_ea_numbers.sql` has been applied to the project you are about
      to run this against. `supabase migration list` says so.
- [ ] **The Worker deployed on that project is from that commit or later.** This is the whole
      precondition. Check the Cloudflare deploy log, or load `/admin/nn/` and confirm the
      entries table has no **EA number** column and the affiliated panel is headed
      **Affiliated entries**.
- [ ] Not during a [change freeze](../../foundations/glossary.md#platform-and-delivery), and
      not while entries are open if it can wait — this is a column drop and there is no reason
      to run it on a busy day.

If the deployed Worker is older than the expand step, **stop**. Dropping the columns under it
breaks the admin surface, and there is nothing to gain by being early.

---

## What to write

A migration, reviewed like any other. It is small; the care is in what it must **not** miss.

### 1. The columns

```sql
alter table entries.entrants  drop constraint entrants_ea_number_not_collected;
alter table entries.entrants  drop constraint entrants_ea_number_check;
alter table entries.entrants  drop column ea_number;

alter table entries.fees drop constraint fees_ea_number_not_collected;
alter table entries.fees drop column requires_ea_number;
```

**`entries.fees.affiliated` stays and is not renamed.** It is the fact `requires_ea_number` was
carrying by accident — which fee is the affiliated price — and it is what the **Affiliated
entries** figure and the affiliated export count. See ADR-023.

### 2. The reads that still emit the keys

Both are `create or replace`, both keep their argument lists, and both need the same
verbatim-plus-one-line treatment every other read here has had.

| | What to remove |
| --- | --- |
| `entries.read_entry_list()` | `entrant.ea_number` and `fee.requires_ea_number` from the row select; `'ea_number'` and `'requires_ea_number'` from the emitted object; the `'affiliated_missing_ea', 0` key |
| `entries.read_export()` | `'ea_number', null` from the `ea` branch's object |

### 3. `transfer_entry()`

⚠️ **There are three forms now, not two — [ADR-025](../../architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md)
added an eleventh argument on 30 August 2026, and it carries `p_ea_number` too.** It had to:
Postgres identifies a function by its argument *types*, and the phone number could not be a
tenth `text` because that signature is already the England Athletics form, which
`create or replace` cannot rename. So this step is bigger than it was, and the shape it is
aiming at is **one function taking ten arguments, the tenth being `p_phone`**.

The Worker calls the **eleven**-argument form. The nine- and ten-argument forms are wrappers
that delegate with a null phone.

1. Recreate the implementation as a **ten**-argument function ending `p_phone text`, with the
   `ea_number_required` branch and the `v_ea` variable deleted — both are unreachable, because
   no fee can require a number.
2. Drop all three of the old forms.

```sql
drop function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text, text);
drop function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text);
drop function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text);
```

**Drop the two wrappers only once the Worker calls the new ten-argument form**, which is the
ordinary expand/contract sequencing and is why this is a step rather than a line. Nothing
sequences a migration against the Cloudflare deploy.

**And update `packages/shared/src/admin.ts`'s `transferEntry`**, which names `p_ea_number: null`
today with a comment saying why. Both go together.

**Check the grant list afterwards.** `packages/db/tests/entries.test.ts` asserts the exact set
of functions `authenticated` may call, by name and argument list. Dropping an overload changes
that list, and the test is what forces the change to be deliberate.

### 4. `assert_entrant_rules()`

Its England Athletics branches — the guide clause and the biconditional — reference the column
and will not compile without it. Replace the function with the same body minus those branches,
and say in the header that the rule they enforced is gone rather than moved.

### 5. `entries.admin_audit.action`

**Leave `ea_export` alone.** The export kind is still `ea`; only its columns changed. Widening
or narrowing that closed list is
[a merge hazard CLAUDE.md spends a paragraph on](../../../CLAUDE.md), and there is nothing to
gain here.

---

## What to change outside the schema

Each of these still names a key that will no longer exist, and each is why this is a runbook
rather than a one-line migration.

- [ ] `packages/db/src/database.types.ts` — regenerate with `npm run db:types`.
- [ ] `packages/shared/src/admin.ts` — the comment in `entryShape` explaining why `ea_number`
      and `requires_ea_number` are on the wire and not parsed, the same comment in `eaRowShape`,
      and the `affiliated_missing_ea` note on `AdminEventFigures`.
- [ ] `packages/shared/src/entry-state.ts` — the comment in `feeShape` saying the same thing.
- [ ] `packages/db/tests/entries-admin.test.ts` — the `ea` export's expected key list, which
      still includes `ea_number` and asserts it is null.
- [ ] `packages/db/tests/entries-rules.test.ts` and `entries-guides.test.ts` — the bypass
      attempts that post a number. **Keep the ones that post at
      `create_pending_purchase()`**; they stop asserting the column is null and start asserting
      the call still succeeds and the key goes nowhere. Delete only the ones reading the column
      back, because there will be nothing to read.
- [ ] `packages/db/supabase/seed.sql` and `apps/main/tests/admin-db.ts` — no change expected;
      both already omit the column. Grep to be sure.
- [ ] This runbook, ADR-023 and the CLAUDE.md paragraph naming it — mark the step done rather
      than deleting the record. The reason the two-step existed is worth more than the tidiness.

---

## Afterwards

- [ ] `./dev check` and `./dev test` both green, through a subagent as usual.
- [ ] `/admin/nn/` loads, the entries table renders, and all three exports download.
- [ ] Transfer one fixture entry on an affiliated place. **That is the case the whole England
      Athletics rule once broke** — see ADR-023's consequences — and it is the one worth
      pressing by hand.
