# `packages/db` — schema, migrations and generated types

The schemas **this repository owns**: `club` and `intake`.
[ADR-002](../../../docs/architecture/decisions/adr-002-schema-layout.md).

## The rule that matters most

**Two repositories share one Postgres**, and will until the timing platform joins the
monorepo. Supabase keeps a single migration history per project, so this needs a rule
rather than good intentions:

|  |  |
| --- | --- |
| `public`, `private` | **The timing platform's.** Migrated from `src-race-timing`. Not a column, not a policy, not ever from here |
| `club`, `intake` | Migrated from here |
| Diff and push | Always schema-scoped — `--schema club,intake` |
| `supabase db reset` | **Local only.** Against the shared remote it destroys the other application's data |

## What is in it

Three schemas, eight tables and nine functions.

|  |  |
| --- | --- |
| `club` | Members, memberships, benefits, documents. Closed: **no tables yet**, no grants, and **not exposed through PostgREST at all** |
| `intake` | Public form submissions |
| `intake.nn_interest` | Expressions of interest in Nightingale Nightmare. **Four columns and an id.** Anonymous **insert only** — see below |
| `intake.health()` | Returns `now()`. The skeleton's connectivity check |
| `intake.ping()` | Returns `'pipeline-ok'`. The same check for a migration added later |
| `entries` | Race entries, event configuration and payment references. **The anon role holds no grant on any table in it** — see below |
| `entries.webhook_secrets` | The **SHA-256 digest** of the key the Stripe webhook presents, never the key. RLS on, no policy, no grant. Ships with a null digest, which refuses everything — installing it is a manual step |
| `entries.entry_state()` | Public configuration for one event: window state and fees. Reads nothing personal |
| `entries.create_pending_purchase()` | Holds a place and records a pending purchase, under a per-event lock. **The only object in this repository that writes an entry** |
| `entries.expire_pending_holds()` | Moves lapsed holds to `expired`. Housekeeping — capacity does not depend on it |
| `entries.attach_checkout_session()` | Writes the Stripe session id onto a pending purchase that has none. One column, one row, once |

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
| `events` | One running of one race in one year, and **every value that differs between events** — capacity, the entry window, the minimum age, whether a date of birth is collected. A new race is an `insert`, not a deploy |
| `fees` | What an entry costs, **in pence, and the only place a price exists**. Passed as `price_data` at Checkout, never as a Stripe Price object — a price held in two systems is a price that will disagree with itself |
| `discount_codes` | Percentage discounts. **Deliberately empty**: the 2023 LHGRC code has not been confirmed for 2026 |
| `entry_purchases` | One payment covering one or more entrants. **The Stripe reference, never the payment instrument** |
| `entrants` | One runner. **No age column and no category column** — both are derived at read time from `date_of_birth` and `gender`, as the timing platform does |
| `entrant_medical` | Medical notes, **on their own** — see below |

#### The anon role holds nothing here, and entries are written anyway

Not insert, not select, on any of the six. RLS is on from the first migration and there is
no grant, so a request is refused at `42501` before row-level security is even consulted.
`tests/entries.test.ts` asserts that on **every table, for every verb, by error code**, and
that assertion was written to outlive the slice that added it — which it now has. **Entries
are written to these tables and every refusal still holds**, because every write goes through
a `security definer` function rather than through a grant. If one of those assertions ever
starts failing, something handed a table privilege to a key that is published in page source.

**`entries` *is* exposed through PostgREST**, and that is what makes those assertions worth
anything. A refusal that only happens because nothing can get as far as asking has not been
tested. What the exposure is actually for is **six functions** — and a seventh,
`entries.raise_attention()`, which is granted to **nobody at all** and is reachable only from
inside `record_checkout_event()`, because it writes the flag that says a purchase needs a human.

`tests/entries.test.ts` asserts that exact set, by name, along with which of them `anon` may
execute. **That assertion is the one this schema's whole shape rests on**, and until this slice
it existed only as prose in four READMEs.

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
| **Escalate through an unpinned search_path** | `set search_path = ''` with every reference schema-qualified, as `entry_state()` already is. `citext` comparisons are done with `lower(...::text)` rather than by unpinning the path to reach the `extensions` operator |

**It can hold places, though**, up to the whole field, for as long as a hold lasts — the same
exposure `intake.nn_interest` already carries, answered the same way: a Cloudflare WAF
rate-limiting rule, recorded in [`apps/main`](../../apps/main/README.md#what-the-entry-form-deliberately-does-not-do).

**`volatile` is load-bearing rather than a default that happened to be right.** Under READ
COMMITTED a `stable` function's queries run against the *calling* statement's snapshot — so
the capacity count would be taken from before the transaction it had just waited behind
committed, and the advisory lock would protect nothing at all. `tests/entries-capacity.test.ts`
asserts the volatility from the catalogue for exactly that reason.

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
| Confirmed | 1 November 2026, 11:00, 250 places, £15 affiliated, £17 unaffiliated, £0 for a VI guide |
| `entries_open_at` / `entries_close_at` | **Null.** Nobody has decided when entries open, and a placeholder would be a published claim about when a race opens. Null reads as `pre_open`, which is the interest form |
| `minimum_age` | **18**, confirmed by the committee on 13 August 2026. It was null while it was only *implied* by the youngest prize category, and landing it was **one `update` in a later migration with no deploy** — which is the whole reason it is a column, demonstrated |
| `discount_codes` | **No rows.** The 2023 code has not been confirmed for 2026. The redemption path is built and tested against fabricated events anyway, so enabling it is one `insert` rather than a deploy in the middle of a live entry window |

**The minimum age was applied by `update`, not by editing the migration that seeded the row.**
That migration has already run — locally, in CI, and on the shared project. Editing it would
change what a fresh `db reset` produces without changing any existing database, which is how
two environments start disagreeing about a rule that turns entrants away.

## Commands

```bash
npm run db:start        # Postgres, auth, storage — Docker
npm run db:reset        # migrations from zero, then seed
npm run db:diff         # generate a migration, scoped to club,intake,entries
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

Three files, all against the real local Postgres rather than a mock — there is no API tier
between the browser and the database, so a mock would only ever test the mock.

| | |
| --- | --- |
| `tests/schemas.test.ts` | That `intake` is reachable and **`club` is not** |
| `tests/seed.test.ts` | That the seed applied, and that the table has **exactly one policy** |
| `tests/nn-interest.test.ts` | The grant and the policy, **from both sides** |
| `tests/entries.test.ts` | That every table in `entries` refuses the anon role, on every verb — and keeps refusing now that entries are written |
| `tests/entries-capacity.test.ts` | What `create_pending_purchase()` does, **including under real concurrency** |

`entries-capacity.test.ts` runs against fabricated `zz-cap-*` events it creates and removes,
so it cannot collide with the real `nn-2026` row, with the acceptance suite, or with a laptop
somebody has left `./dev up` running on. The advisory lock is per event id, so fabricated
events do not contend with each other either.

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
| _Add the GitHub Actions secrets_ | Migrations need a credential; Cloudflare does not | _pending_ | Repository → Settings → Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` |
| _Confirm `intake` is exposed on the remote_ | `config.toml` may not reach that setting | _pending_ | Dashboard → Settings → API → exposed schemas. **Record the answer here** — it is one of the open "which settings are dashboard-only" questions |

## One ordering fact worth knowing

**Nothing sequences the migration against the Cloudflare deploy.** Workers Builds triggers
on the push, not on a green CI run, so the schema change and the code that uses it go out
concurrently and in no guaranteed order.

That is survivable only because
[expand–migrate–contract](../../../docs/architecture/principles.md#expand-migrate-contract)
is a principle rather than a preference. **Every schema change must keep the previously
deployed code working.** If a change needs the migration to land first, that change is the
thing to fix.
