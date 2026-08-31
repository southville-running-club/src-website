# `packages/db` — schema, migrations and generated types

> ⚠️ **This file describes the schema roughly as it stood in Slice G (mid-to-late August
> 2026) and has drifted from it in several places since — the counts, the fees, the
> discount-code state and the `entries_open_at`/`entries_close_at` claims below are all
> corrected inline, but the detailed walk-through of the admin surface's key-and-grant
> mechanism (§ "The anon role holds nothing here") predates the `identity` schema, the
> `nn-admin`/`people-admin`/`super-admin` roles and the retirement of the two-key scheme.
> For the current state of any of that, [`CLAUDE.md`](../../../CLAUDE.md) at the repository
> root is the reference, and `tests/entries.test.ts` /
> `tests/identity-permissions.test.ts` are what is actually enforced. Bringing this file
> fully current — including an `identity` section — is its own piece of work; treat
> anything here about roles, permissions or the admin surface as historical until then.**

The schemas **this repository owns**: `club`, `intake`, `entries` and `identity`.
[ADR-002](../../../docs/architecture/decisions/adr-002-schema-layout.md) named the first
two; `entries` and `identity` were added once race entries and member accounts were built.

## The rule that matters most

**Two repositories share one Postgres**, and will until the timing platform joins the
monorepo. Supabase keeps a single migration history per project, so this needs a rule
rather than good intentions:

|  |  |
| --- | --- |
| `public`, `private` | **The timing platform's.** Migrated from `src-race-timing`. Not a column, not a policy, not ever from here |
| `club`, `intake`, `entries`, `identity` | Migrated from here |
| Diff and push | Always schema-scoped — `--schema club,intake,entries,identity` |
| `supabase db reset` | **Local only.** Against the shared remote it destroys the other application's data |

## What is in it

Four schemas. Table and function counts are not restated here — they only ever drift —
`tests/entries.test.ts` and `tests/identity-permissions.test.ts` assert the exact sets and
are the thing to read for a current number.

|  |  |
| --- | --- |
| `club` | Members, memberships, benefits, documents. Closed: **no tables yet**, no grants, and **not exposed through PostgREST at all** |
| `intake` | Public form submissions |
| `intake.nn_interest` | Expressions of interest in Nightingale Nightmare. **Four columns and an id.** Anonymous **insert only** — see below |
| `intake.health()` | Returns `now()`. The skeleton's connectivity check |
| `intake.ping()` | Returns `'pipeline-ok'`. The same check for a migration added later |
| `entries` | Race entries, event configuration and payment references. **The anon role holds no grant on any table in it** — see below |
| `entries.webhook_secrets` | The **SHA-256 digest** of a shared key a caller must present, never the key. **The `stripe` row, for the payment webhook, is live** — RLS on, no policy, no grant, ships with a null digest that refuses everything until installed. The `admin` row belonged to the retired two-key admin scheme (see below) |
| `entries.admin_keys` | **Retired, and unused.** Belonged to the two-key admin scheme (one row per person's key digest); the admin surface is reached by signing in and holding a role since #57/#58. Ships empty and stays empty |
| `entries.admin_audit` | Who opened the admin surface, who read a medical note, who exported what. **Never the contents.** RLS on, no grant |
| `entries.entry_state()` | Public configuration for one event: window state and fees. Reads nothing personal |
| `entries.current_entry_state()` | The same answer for the **current running of a recurring race**, so a page about the race never has to name a year. Discloses nothing `entry_state()` does not |
| `entries.create_pending_purchase()` | Holds a place and records a pending purchase, under a per-event lock. **The only object in this repository that writes an entry** |
| `entries.expire_pending_holds()` | Moves lapsed holds to `expired`. Housekeeping — capacity does not depend on it |
| `entries.attach_checkout_session()` | Writes the Stripe session id onto a pending purchase that has none. One column, one row, once |
| `entries.record_checkout_event()` | The only object that writes `paid`. **Takes a key** — [ADR-010](../../../docs/architecture/decisions/adr-010-webhook-writes-paid.md) |
| `entries.entry_completion_state()` | One word about one Checkout session. No personal data, and not the purchase id |
| `entries.raise_attention()` | Flags a purchase for a human. **Granted to nobody** |
| `entries.delete_expired_medical_notes()` | Deletes medical notes for events past their retention period. Housekeeping, on the five-minute cron. **`/nn/privacy/` no longer publishes this period as a promise** — since 30 August 2026 that page is the committee's document verbatim and names no interval, so the tie between the enforced period and a published one now survives only in `entries-retention.test.ts`. **The one anon-callable function that takes no key**, deliberately, because a legal retention obligation should not stop being kept on any day the admin key was not installed |
| `entries.record_admin_action()` | Writes one audit row. **Granted to nobody** — a forgeable audit trail is worse than none |

**`entries.admin_sign_in()` and `entries.admin_key_ok()` are unreferenced and retired**,
along with the rest of the two-key scheme, since #57/#58. **The other four still exist and
are still active** — they still appear in migrations as recent as 29 August 2026 — but their
auth mechanism has moved: the admin surface is now reached by signing in and holding a role
(`nn-admin`, or `people-admin`/`super-admin` where relevant), checked through
`identity.has_permission()`, rather than by presenting a key. Read the rows below as "still
here, differently gated" rather than "takes a key". See [`CLAUDE.md`](../../../CLAUDE.md)'s
admin-surface section and `tests/entries.test.ts` / `tests/identity-permissions.test.ts` for
the current signatures and grants.

| ~~`entries.admin_key_ok()`~~ | Whether the caller presented the admin key. Retired with the two-key scheme |
| ~~`entries.admin_sign_in()`~~ | Checked the Worker's key, then a person's, and answered with their handle. Retired |
| `entries.admin_entry_list()` | The entries for one event, one row per entrant. No date of birth, no email address, no medical note. **Permission-checked, not key-gated** |
| `entries.admin_interest_list()` | The interest sign-ups, with the consent shown rather than filtered. **Permission-checked, not key-gated** |
| `entries.admin_entrant_medical()` | One medical note, and the audit row recording the read, in one transaction. **Permission-checked, not key-gated** |
| `entries.admin_export()` | One of three CSV exports, with the audit row, in one transaction. **Permission-checked, not key-gated** |

`intake.health()` earns its place: one call proves the migration applied, the schema is
exposed, the anon key is right, the grant is right, and the Worker can reach the network.
It reads nothing and holds nothing.

### `intake.nn_interest`, and the one door into it

`name`, `email`, `consent`, `created_at`, and an `id`. **Adding a fifth column is a
committee decision, not a build decision** — not date of birth, not phone, not emergency
contact, not England Athletics number. `tests/seed.test.ts` asserts the exact column list,
and that test failing because somebody added one is the test doing its job.

The table was created with RLS on and **no policy and no grant**, which denied everyone.
The sign-up form is what needed the door, so the door arrived with it:

```sql
grant insert (name, email, consent) on table intake.nn_interest to anon;

create policy "anon may record an expression of interest, and read nothing back"
  on intake.nn_interest for insert to anon
  with check (
    length(trim(name)) between 1 and 100
    and position('@' in email) > 1
  );
```

Four things about that are load-bearing:

| | |
| --- | --- |
| **The grant is column-scoped** | `id` and `created_at` are absent, so they keep their defaults and **a caller cannot supply either** — no back-dated sign-up, no chosen primary key. PostgREST refuses the attempt with `42501` rather than ignoring the column |
| **There is no `select`, `update` or `delete` grant. Ever** | There is no API tier, so this grant *is* the access control. A select grant would make the interest list readable by anyone holding the anon key, which is **published in client code by design**. That is a personal-data incident, not a bug |
| **`with check` is stated, not defaulted** | It mirrors the table's own constraints, so the two cannot drift into disagreeing about what a valid row is |
| **It says nothing about consent** | Deliberately. The *form* currently requires the box to be ticked; `consent` is `not null` and `false` is a legitimate stored value. Reversing that decision is two lines of TypeScript and **no second migration** |

One visible consequence, and it is the right one: **`insert().select()` fails.** Asking for
the row back needs a select grant. `apps/main/worker/nn-signup.ts` never asks, and
`tests/nn-interest.test.ts` asserts that asking is refused.

**There is no rate limiting on the endpoint in front of this.** The unique index stops the
same address twice and nothing else. See
[`apps/main`](../../apps/main/README.md#what-it-deliberately-does-not-do).

**`club` is absent from `config.toml`'s `api.schemas`, and that absence is a second lock.**
Even if a grant on a `club` table were wrong one day, PostgREST would have no route to it.
Adding `club` there is a decision, not a convenience.

### `entries`, and why it is a third schema

An entry is not an expression of interest. It carries a payment reference, a date of birth,
an emergency contact and — under its own separate consent — free-text medical information,
which is **special category data under UK GDPR Article 9**. The schema boundary is the blast
radius: a policy that is wrong on `intake` is a nuisance, and the same policy wrong here is a
personal-data incident and a financial one at once.
[ADR-009](../../../docs/architecture/decisions/adr-009-entries-in-apps-main.md).

| | |
| --- | --- |
| `events` | One running of one race in one year, and **every value that differs between events** — capacity, the entry window, the minimum age, whether a date of birth is collected, and how long its medical notes are kept. A new race is an `insert`, not a deploy |
| `fees` | What an entry costs, **in pence, and the only place a price exists**. Passed as `price_data` at Checkout, never as a Stripe Price object — a price held in two systems is a price that will disagree with itself |
| `discount_codes` | Percentage discounts, scoped to one fee. **No longer empty** — Left Handed Giant's 2026 code was minted by migration and raised to 25 places on 30 August 2026; see [the runbook](../../../docs/delivery/runbooks/entries-discount-codes.md). The code itself is never in this repository, only the generator |
| `entry_purchases` | One payment covering one or more entrants. **The Stripe reference, never the payment instrument** |
| `entrants` | One runner. **No age column and no category column** — both are derived at read time from `date_of_birth` and `gender`, as the timing platform does. `gender` is the **race category**, three values, and `gender_identity` beside it is the open question nothing derives from — [ADR-020](../../../docs/architecture/decisions/adr-020-race-category-and-gender-are-two-questions.md) |
| `entrant_medical` | Medical notes, **on their own** — see below |

#### The anon role holds nothing here, and entries are written anyway

Not insert, not select, on any table in this schema. RLS is on from the first migration and there is
no grant, so a request is refused at `42501` before row-level security is even consulted.
`tests/entries.test.ts` asserts that on **every table, for every verb, by error code**, and
that assertion was written to outlive the slice that added it — which it now has. **Entries
are written to these tables and every refusal still holds**, because every write goes through
a `security definer` function rather than through a grant. If one of those assertions ever
starts failing, something handed a table privilege to a key that is published in page source.

**`entries` *is* exposed through PostgREST**, and that is what makes those assertions worth
anything. A refusal that only happens because nothing can get as far as asking has not been
tested. What the exposure is actually for is a small, named set of functions granted to
`anon` — **do not trust a count written in this paragraph**; `tests/entries.test.ts` asserts
the exact set by name and is what has to change for the set to change. A further handful are
granted to **nobody at all**, reachable only from the definer functions that call them —
`raise_attention()`, which writes the flag that says a purchase needs a human, and
`record_admin_action()`, which writes the audit trail, are two of them. Each would be a hole
on its own — an alarm anybody could forge, an audit trail anybody could fill.

**Several of the anon-callable functions take a key**, and the key is what makes an anon
grant safe on a function that writes money or reads a person:
[ADR-010](../../../docs/architecture/decisions/adr-010-webhook-writes-paid.md) established the
mechanism for the payment webhook. **The admin surface's own key-gated functions
(`admin_sign_in()`, `admin_key_ok()` and the two-key scheme generally) are retired** — since
#57/#58 the admin surface is reached by signing in and holding the `nn-admin` role, checked
through `identity.has_permission()`, and `entries.admin_keys` ships empty and unused. What
replaced it, and the current list of what `anon` and `authenticated` may each call, is in
[`CLAUDE.md`](../../../CLAUDE.md) and asserted in `tests/entries.test.ts` and
`tests/identity-permissions.test.ts` — read those rather than a count here.

`tests/entries.test.ts` asserts that exact set, by name, along with which of them `anon` may
execute. **That assertion is the one this schema's whole shape rests on**, and it has earned
its keep repeatedly: every function added to the anon-callable set has had to be added to that
list in a diff somebody read, with the argument for each written into the test beside the
list.

#### `entries.entry_state()` — the one door

`/nn/` has to know whether entries are open, because that decides whether it shows the entry
form or the interest form, and the switch has to be an event row rather than a deploy. A
`select` grant on `entries.events` would do it — and would put an exception into the "anon
can select nothing here" test on its first day, which is how the next exception gets waved
through.

So it is a `security definer` function instead, returning the handful of public facts a form
needs: window state, the event's configuration, and the fees with their prices. **No table
privilege anywhere**, and the refusal test stays literally true.

It deliberately returns neither `from_address` (an address in page source is an address a
scraper collects) nor the event's `id` (a browser has no use for a primary key it cannot
write with) nor the window timestamps (nobody has decided them, and a field returned before
it has a meaning is a field somebody renders).

#### `entries.current_entry_state()` — the same door, without a year in it

`entry_state()` needs the caller to know the event slug. That is right for `/nn/2026/`, whose
whole subject is one running. It is wrong for `/nn/`, which is about the **race** — because a
page that has to name `nn-2026` has 2026 written into it, and publishing 2027 then means
editing every page that mentions it rather than inserting a row.

So `entries.events` grew one column, `race_slug`, which is the glossary's race-and-event
distinction finally put somewhere it can be queried. `current_entry_state('nn')` picks the
**forthcoming** running of that race, else the **most recent past** one, and hands back exactly
what `entry_state()` would have returned for it — including the slug, which is how the caller
learns which year page to point at.

| | |
| --- | --- |
| **Why the fallback to a past running** | Between one November and the day next year's row is added there is no forthcoming event. Returning nothing would make `/nn/` a dead end for the months when somebody is most likely looking for what happened last time |
| **Why it discloses nothing new** | It returns `entry_state()`'s answer for an event the caller could have named itself — the slug is in the page's own URL. `tests/entries.test.ts` asserts the two answers are equal, so a field added to one and not the other fails |
| **Why "today" is Europe/London** | `event_date` is civil time, as published. For an hour on a winter night UTC and London disagree about the date, and the day this comparison flips is the day after the race |
| **Why no index** | One row per race per year — single figures. An index here is a line to maintain in exchange for nothing measurable |

#### `entries.create_pending_purchase()` — the only thing that writes

One call, one transaction: resolve the event, take a capacity lock, count the places already
gone, price the entry **from the fees table**, and write the purchase, its entrants and — only
under its own consent — their medical notes. It returns a structured result rather than
raising, because `sold_out` is a page somebody reads rather than an error somebody debugs.

**The anon key is published in client code, so this function is the attack surface.** What it
cannot do is the point of its shape:

| | |
| --- | --- |
| **Read anything back** | It returns the caller's own purchase id, amount and fee label. Nothing about anybody else |
| **Choose a price** | `p_fee_code` selects a row; `entries.fees.price_pence` is what is charged. A price in the form is never consulted, and there is no parameter for one |
| **Choose a status, a paid timestamp, an id or a created_at** | None is a parameter |
| **Write to a different event than the slug names** | Every insert is scoped to the resolved row |
| **Store medical notes without the separate consent** | Whatever the form sent |
| **Enter without agreeing what the event requires** | `events.required_consents` names the keys; each must be present and json `true`. Refused as `consents_missing` |
| **Store an England Athletics number** | Nowhere, by any route. `entrants_ea_number_not_collected` refuses a value in the column and `fees_ea_number_not_collected` refuses a fee that would ask for one — [decision 007](../../../docs/decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers). **The rule used to be the opposite of this**: an affiliated place with no number was refused as `ea_number_required`, and *that* was the Slice E finding — until Slice G nothing consulted `fees.requires_ea_number` at all |
| **Escalate through an unpinned search_path** | `set search_path = ''` with every reference schema-qualified, as `entry_state()` already is. `citext` comparisons are done with `lower(...::text)` rather than by unpinning the path to reach the `extensions` operator |

**It can hold places, though**, up to the whole field, for as long as a hold lasts — the same
exposure `intake.nn_interest` already carries, answered the same way: a Cloudflare WAF
rate-limiting rule, recorded in [`apps/main`](../../apps/main/README.md#what-the-entry-form-deliberately-does-not-do).

**`volatile` is load-bearing rather than a default that happened to be right.** Under READ
COMMITTED a `stable` function's queries run against the *calling* statement's snapshot — so
the capacity count would be taken from before the transaction it had just waited behind
committed, and the advisory lock would protect nothing at all. `tests/entries-capacity.test.ts`
asserts the volatility from the catalogue for exactly that reason.

#### Where a rule lives, and why Zod is never the only place

**Slice E found `create_pending_purchase` writing `ea_number` straight through without ever
consulting `fees.requires_ea_number`.** The column permits null, the function is granted to
anon, and the anon key is published in page source — so two PostgREST calls produced an
affiliated entry with no England Athletics number, at £2 less, unverifiable. The Zod schema
did require it. **Zod is the form's control, not the system's**, and it was found by accident
while building a count for a dashboard.

**That particular rule no longer exists**, because on 29 August 2026 the club stopped asking
for the number at all — decision 007 and
[ADR-023](../../../docs/architecture/decisions/adr-023-no-england-athletics-numbers.md). The
finding is kept here because it is what this whole section is an answer to, and because the
bypass it names is still the shape of the test: `entries-rules.test.ts` posts a number straight
at PostgREST with the published key and asserts it reaches no column.

Slice G audited every rule the club has by *attempting the bypass* with an anonymous client
rather than by reading the code, and found eight more like it — including that the entry terms
were not enforced at all, and that a medical note could be written against a purchase that
withheld the consent for it. All nine are closed, and each has a test in
[`tests/entries-rules.test.ts`](tests/entries-rules.test.ts) that tries the bypass and asserts
the **specific** refusal.

Three places, and which one a rule goes in is decided by what it needs to see:

| | For | Why not somewhere else |
| --- | --- | --- |
| **A check constraint** | A rule about one row: a birth year at or after 1900, an emergency number with seven digits in it, an address with a domain, a consent value that is a boolean | It cannot see another table, so it cannot express most of the interesting ones |
| **A trigger** | A rule spanning tables: the medical note against its consent, the consents against the event, the date of birth against the race date, the entrant against the event's minimum age, the leg against the event's size | It only ever sees a write, so it can say nothing about the rows already there |
| **The function** | The ones a person needs a sentence about — `consents_missing`, `under_minimum_age`, `already_entered` — so the form can render words rather than a generic failure | It is one write path. The trigger is what covers every other |

**The triggers raise `check_violation` on purpose**, so `create_pending_purchase`'s existing
handler turns them into the structured refusal the Worker has rendered since Slice B rather
than a 500 carrying a Postgres string. Their messages name the rule and never the value — an
exception travels into a log, and no personal data goes in a log here, error paths included.

**The four check constraints are `NOT VALID`, and that is not a half-measure.** They are
enforced on every insert and update from the moment they landed; what `NOT VALID` skips is the
scan of the rows already there, because nobody could see the production rows and a validated
`ADD CONSTRAINT` **fails the migration if one row disagrees**. Turning them into ordinary
constraints is
[one command each](../../../docs/delivery/runbooks/entries-constraints.md), after somebody has
looked at the table.

**`events.required_consents` is per event rather than per platform**, for the same reason
`consents` is jsonb at all: the set of consents differs between races, and a table constraint
naming `entryTerms` would write one race's checkbox list into the schema for every race after
it. Nightingale Nightmare 2026 takes the default, `{entryTerms}`.

#### Capacity, and the lock

250 places, and this race sold out in 2023. `pg_advisory_xact_lock` on a hash of the event id
is taken **before** the count, so count-and-insert is serialised per event and nothing else in
the database waits. `_xact_` rather than a session lock: it is released when the transaction
ends, including when the connection dies mid-statement.

**A lapsed hold does not consume a place, and the count is what says so.** The Cron Trigger in
`apps/main` that moves lapsed holds to `expired` is housekeeping — if it never ran again,
nobody would be turned away and nothing would be double-sold. That property is the one to
preserve if it is ever changed.

`tests/entries-capacity.test.ts` proves the lock with real concurrent connections — two, then
eight, competing for one place — **and proves the harness can detect overselling** by
overselling on purpose with the lock left out. A concurrency test that never actually
overlaps passes for the wrong reason and keeps passing after somebody deletes the lock.

**It lives in `entries`, not in `private`.** The timing platform keeps its helpers in
`private` with a pinned `search_path`, and that is the pattern — but `private` is the timing
platform's and this repository does not touch it. The property that mattered was the pin,
and `set search_path = ''` is on this function too.

#### `entrant_medical` is a separate table, and the reason is the law

Free-text medical information is special category data. It needs its own explicit consent,
its own access control, and a shorter retention than the rest of an entry — and a separate
table makes each of those a simple thing rather than a careful thing:

- **Retention.** "Delete the medical information one month after the race" is a `delete` on
  one table. As a column on `entrants` it would be a column-scoped `update` that has to be
  right about which rows it touches, run against the table holding everybody's name.
- **Access.** A future policy letting a first-aid lead see medical notes grants on this table
  and reaches nothing else.
- **Consent.** The row exists only where the separate consent was given, so **the absence of
  a row is the record of a withheld consent**. There is no state where notes are stored and
  the consent that would have permitted them is false — a filter cannot be forgotten if
  there is nothing to filter.

The Worker drops the notes *before* they would reach the database when the box is unticked,
rather than storing and filtering later. Minimisation at the boundary.

#### What is seeded, and what is deliberately null

The Nightingale Nightmare 2026 event and its three fees ship **in the migration**, not in
`seed.sql`: this is a real event row that production needs, and `seed.sql` never runs against
production.

| | |
| --- | --- |
| Confirmed | 1 November 2026, 11:00, 250 places, **£18 affiliated, £20 unaffiliated** since 24 August 2026 (was £15/£17 at seeding), £0 for a visually impaired runner's guide |
| `entries_close_at` | **Set.** The window was ratified by the committee on 24 August 2026: opens Tuesday 1 September 2026 07:00 BST, closes Friday 30 October 2026 17:00 GMT |
| `entries_open_at` | **Still null, deliberately — this is the one still worth treating as unconfirmed.** Ratifying the window is not the same as arming it: this column is the switch that starts selling 250 places unattended, and it is gated on the live Stripe keys being installed. A date in it is a stop-and-ask, not a build decision |
| `minimum_age` | **18**, confirmed by the committee on 13 August 2026. It was null while it was only *implied* by the youngest prize category, and landing it was **one `update` in a later migration with no deploy** — which is the whole reason it is a column, demonstrated |
| `discount_codes` | **No longer empty at seeding time either** — see the row above; a code is minted by a later migration once the committee confirms it, never seeded with the event |

**The minimum age was applied by `update`, not by editing the migration that seeded the row.**
That migration has already run — locally, in CI, and on the shared project. Editing it would
change what a fresh `db reset` produces without changing any existing database, which is how
two environments start disagreeing about a rule that turns entrants away.

## Commands

```bash
npm run db:start        # Postgres, auth, storage — Docker
npm run db:reset        # migrations from zero, then seed
npm run db:diff         # generate a migration, scoped to club,intake,entries,identity
npm run db:types        # regenerate src/database.types.ts
npm run db:types:check  # fails if the committed types are stale
npm run db:config:push  # send config.toml to the linked project
npm run entries:open    # open the NN entry window locally, so /nn/ shows the entry form
npm run entries:close   # back to the seeded state — the interest form
```

**`config.toml` needs a restart, not a reset.** `supabase db reset` re-applies migrations
against the running containers; the exposed-schema list is read when the API container
*starts*. Adding `entries` to it and only resetting gives `PGRST106 Invalid schema` from
every call, which reads as a broken migration. `npm run db:stop && npm run db:start`.

## Three layers, and all three are code

Worth separating, because `public` is the name of a Postgres schema and has **nothing** to
do with public access.

| | Controlled in | |
| --- | --- | --- |
| **Does it exist?** | `supabase/migrations/` | `create schema`, `create table` |
| **Can the API route to it?** | `supabase/config.toml` → `[api] schemas` | Off the list means `PGRST106`, whatever the grants say |
| **Who may do what?** | `supabase/migrations/` | `grant`, and RLS policies |

Something is reachable only when **both** the second and third permit it. That is why
`club` is blocked twice — not exposed, and not granted — and why `intake.nn_interest` holds
seven seeded rows that no anonymous caller can read.

### One file, three environments

The middle layer is the one that could plausibly drift, so it deliberately does not have
three sources of truth:

| | How `[api] schemas` gets applied |
| --- | --- |
| **Local** | `supabase start` reads `config.toml` straight into the Docker containers |
| **Branch CI** | The same — `supabase start` runs in Actions and reads the same file |
| **Production** | `deploy-db.yml` runs `supabase config push` on merge to `main` |

So **a schema exposed here is exposed everywhere, and one missing here is missing
everywhere.** A pull request tests the real exposure rules rather than an approximation of
them, which is the whole argument for the list living in the repository.

Guarded twice over: `tests/unit/config.test.ts` asserts the list directly — no Docker, a
few milliseconds — and `tests/schemas.test.ts` catches the same mistake by its effect, when
`club` stops returning `PGRST106`.

`npm run db:config:push` runs it by hand for bootstrapping or debugging. **It pushes the
whole file**, not just `[api]` — read the diff it prints, and remember that anything set by
hand in the dashboard is overwritten on the next merge.

`database.types.ts` is **generated**. Editing it by hand will be silently undone, and CI
fails when it drifts.

## Seeding

`supabase/seed.sql` is committed and holds **seven invented rows** in
`intake.nn_interest`. The rules are written in the file itself, so the next person adding a
row inherits them: data only never schema, deterministic, realistic shapes with invented
people, **include the awkward states**, and never a dump of production.
[C10](../../../docs/foundations/requirements.md#c10--hold-personal-data-lawfully) applies to
laptops as much as to servers.

The awkward states are the ones that earn their place — consent withheld, an apostrophe in
a name, a non-ASCII name, and two submissions an hour apart either side of the clocks change
on 25 October 2026 that both render as 01:30 in `Europe/London`.

## Testing

All against the real local Postgres rather than a mock — there is no API tier between the
browser and the database, so a mock would only ever test the mock. **The list below is a
sample, not the full directory** — `tests/` holds around twenty files now, covering the
`identity` schema, entry rules, entry requests, discount codes, transfers and the email
outbox as well as the ones named here; do not treat this table as the complete index.

| | |
| --- | --- |
| `tests/schemas.test.ts` | That `intake` is reachable and **`club` is not** |
| `tests/seed.test.ts` | That the seed applied, and that the table has **exactly one policy** |
| `tests/nn-interest.test.ts` | The grant and the policy, **from both sides** |
| `tests/entries.test.ts` | That every table in `entries` refuses the anon role, on every verb, and asserts the exact set of functions `anon` and `authenticated` may call |
| `tests/entries-capacity.test.ts` | What `create_pending_purchase()` does, **including under real concurrency** |
| `tests/entries-webhook.test.ts` | What `record_checkout_event()` does — the key, idempotency, and a payment that arrived late |
| `tests/entries-rules.test.ts` | Every rule enforced in the database, attempted as a bypass with an anonymous client rather than read from the code |
| `tests/identity-permissions.test.ts` | The five roles and ten permissions, asserted exactly |
| `tests/entries-retention.test.ts` | That the deletion removes only what it should, is safe to run twice, and leaves the entrant intact |

`entries-capacity.test.ts` runs against fabricated `zz-cap-*` events it creates and removes,
so it cannot collide with the real `nn-2026` row, with the acceptance suite, or with a laptop
somebody has left `./dev up` running on. The advisory lock is per event id, so fabricated
events do not contend with each other either. Every file here follows the same rule, with its
own prefix — and **the rule covers cleanup as much as assertions**: `entries.test.ts` once
deleted every `LHGRC10` discount code rather than its own, which failed
`entries-capacity.test.ts` in another file as `invalid_discount` the moment two more files
changed the interleaving.

`entries-admin.test.ts` installs the admin key's digest in `beforeAll` and **takes it out in
`afterAll` whatever happened**, so a laptop is never left with a working admin surface for a
key written in a test file.

**The assertions that matter are the negative ones**, and every one of them asserts the
error *code* rather than merely that something failed — a test that passes because a table
stopped existing is a test that has quietly stopped testing. `PGRST106` for a schema
PostgREST has no route to; `42501` for a missing grant or a refused row.

`tests/nn-interest.test.ts` writes to `intake.nn_interest` to prove the insert policy works
and **removes what it wrote afterwards**, so the seed's own seven rows are what
`seed.test.ts` still sees. The two files can run at the same time.

## Manual steps

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Supabase project_ | Cannot be code | Already done — project `ketipxpyjjglwpqazsft`, `eu-west-2` | — |
| _Add the GitHub Actions secrets_ | Migrations need a credential; Cloudflare does not | **Done** | Repository → Settings → Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` — see [github-setup.md](../../../docs/delivery/runbooks/github-setup.md) for the full set of five |
| _Add `SUPABASE_AUTH_CAPTCHA_SECRET`_ | `deploy-db.yml`'s `supabase config push` sends `config.toml`'s `[auth.captcha]` block, which reads this via `env(...)` — #53 | **Done**, 24 Aug 2026 | Repository → Settings → Secrets and variables → Actions. The Turnstile **secret** key, never the site key — that one is public and lives in `apps/main/wrangler.jsonc` |
| _Add `SUPABASE_AUTH_SMTP_PASSWORD`_ | Same mechanism, for `[auth.email.smtp]` — #50 | **Done**, 25 Aug 2026 | Repository → Settings → Secrets and variables → Actions. A Resend API key scoped to Sending access only |
| _Confirm `entries` and `identity` are exposed on the remote_ | `config.toml` may not reach that setting | **Done** — both schemas have been live in production since their respective builds | Dashboard → Settings → API → exposed schemas |

## One ordering fact worth knowing

**Nothing sequences the migration against the Cloudflare deploy.** Workers Builds triggers
on the push, not on a green CI run, so the schema change and the code that uses it go out
concurrently and in no guaranteed order.

That is survivable only because
[expand–migrate–contract](../../../docs/architecture/principles.md#expand-migrate-contract)
is a principle rather than a preference. **Every schema change must keep the previously
deployed code working.** If a change needs the migration to land first, that change is the
thing to fix.
