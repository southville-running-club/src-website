# ADR-010 — The webhook is the only writer of `paid`, and it presents a key to be one

**Accepted**, 13 August 2026. Extends
[ADR-009](adr-009-entries-in-apps-main.md) and the access-control shape
[ADR-002](adr-002-schema-layout.md) established.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [people](../../foundations/requirements.md#people) |
| **Supersedes** | No ADR. It records three decisions taken while building the webhook |

## Context

Slice B made `/nn/` take money: a valid entry holds a place under a per-event advisory lock,
writes a `pending` purchase with a thirty-one minute hold, and hands over to Stripe Checkout.
**Nothing moved a purchase to `paid`**, deliberately, because the redirect back from Stripe is
not evidence — a tab can be closed before it fires and the return URL is one anybody can type.

This slice builds the thing that does. It is the first code in the platform that runs **after
money has left somebody's account**, and that inverts the rule the two slices before it
followed. Slice A and Slice B fail *towards taking no money*, because none had been taken.
Here the only safe failure is one that is **loud and retried**: a quiet success is somebody
paying £17 and getting no race.

Three decisions had to be taken to build it, and none of them was obvious.

## Decision 1 — a payment that arrives late is `paid`, and the exception rides beside it

A hold lapses at minute thirty-one. The payment arrives at minute thirty-four. The money is
gone from the runner's account and the place is back in the pool.

**The money is never refused**, because refusing leaves the club holding a payment with nothing
against it, which is worse than every alternative. So the purchase becomes `status = 'paid'` —
**the same value as every other payment** — and, when there was no room, `attention =
'over_capacity'` on the same row says a human must decide what happens.

### Why not a fifth status value

A `paid_over_capacity` status was the obvious shape and it was rejected on cost rather than on
correctness. The capacity predicate inside `entries.create_pending_purchase()` counts
`status = 'paid'`. A new value is invisible to it, so an oversold place would read as **free**
and be sold to a second person — one person's problem turned into an unrecoverable double-sale
on race morning.

Fixing that means `create or replace` over the 330-line function whose per-event advisory lock
is the only thing standing between this club and overselling a race that sold out in 2023,
proved under real concurrent connections by `entries-capacity.test.ts` with a deliberate
oversell as its control. **Two volunteers reviewing a restated 330-line body for two changed
hunks is the review this repository cannot afford to get wrong.** Keeping one money-status
means that function is not reopened at all.

The counter-argument is real and is recorded: a start-list query that forgets
`and attention is null` prints a runner who may not have a place, where one that forgot
`paid_over_capacity` would merely omit them — visible and recoverable. It is answered by the
premise being wrong here. The over-capacity runner **has** paid and the club **is** holding
their money; they belong in the answer to "what have we taken", and the race director needs to
know the field is 251 rather than have the 251st runner silently dropped.

### Why the place is consumed

The tempting answer is that an oversold place should not count, since the club never sold it.
That is wrong, and the trap is the club's own most likely remedy.

| | If it does **not** count | If it **does** count |
| --- | --- | --- |
| Committee raises capacity to 251 | count reads 250 of 251 — **the next stranger to press the button takes the place created for the person who already paid** | count reads 251 of 251 — resolves exactly that one person and sells nothing new |
| Entry is refunded instead | nothing to give back | `refunded` is not counted, so the place returns the same instant |

Counting is self-limiting; not counting compounds. With one `paid` status this is free, because
the existing predicate already counts it — which is the second piece of evidence that the shape
is right.

**The consequence to write down:** "sold out" can now mean "oversold and therefore closed", and
the count of unresolved `over_capacity` rows is exactly how many places over the field is. A
race director reading "250 of 250" without running the attention query sets out the wrong
number of bibs. That is in [the runbook](../../delivery/runbooks/entries-attention.md).

### The revival test is the capacity predicate, not the status

A `pending` row whose hold ran out four minutes ago is **already gone** as far as capacity is
concerned, whether or not the five-minute sweep has touched it — Slice B makes "capacity does
not depend on this cron having run" an explicit invariant. Keying the webhook on
`status = 'expired'` would quietly make its correctness depend on a scheduler.

## Decision 2 — idempotency is the state guard, and there is no processed-events table

Stripe retries on any non-2xx and can duplicate regardless. The transition is one guarded
statement whose own `row_count` is both the change and the report of whether it happened:

```sql
update entries.entry_purchases
   set status = 'paid', paid_at = pg_catalog.now(), ...
 where id = v_purchase_id
   and status in ('pending', 'expired');
```

Four things already in the schema do the work: the per-event advisory lock, `select ... for
update`, the `volatile` declaration that makes the post-lock read see committed state, and the
unique index on `stripe_checkout_session_id` that Slice A added for exactly this.

### Why not a table keyed on the Stripe event id

**It does not close the hole it appears to close — it widens it.** The hole people have in mind
is a crash between the transaction committing and a side effect firing. A processed-events
table records the event, Stripe's retry is refused at the door, and the side effect never runs
at all.

Slice D's confirmation email is the real question, and it still does not change the answer.
What makes that safe is a `confirmation_sent_at` marker **on the purchase row**, claimed with
`update ... where confirmation_sent_at is null returning id` and swept by the cron that already
runs — per-purchase, which is the grain the email actually has. The mechanism that will make
Slice D safe is the one built here.

The cost side is specific to this schema: a seventh table in a place whose defining property is
that **no role holds a table privilege on anything**, needing an RLS decision, four new refusal
assertions, a retention story nobody has, and an anon-triggered unbounded insert where none
exists today. Stripe already keeps the delivery log, better, in its own dashboard.

What is recorded instead is `stripe_event_id` on the row, written with `coalesce`, so the
delivery that applied the transition is the one remembered. **Evidence for a post-mortem, never
a key.**

## Decision 3 — the transition function takes a key, and the grant is still `anon`

This is the decision the build brief did not anticipate, and it is not optional.

Every other function in `entries` is safe to grant to `anon` because none can be abused with
what it accepts: `entry_state()` reads public configuration, `create_pending_purchase()` chooses
the price itself, `attach_checkout_session()` writes one column once, `expire_pending_holds()`
can only move a hold that has already lapsed.

**A function that writes `paid` is different.** The anon key is published in page source by
design, and `create_pending_purchase()` is granted to anon and *returns the purchase id and the
amount it computed*. So once entries open, two ordinary PostgREST calls with the published key:

```
1. create_pending_purchase(...)   ->  { purchase_id, amount_pence, ... }
2. record_checkout_event(that id, that amount, 'gbp', any session string)
```

would produce a `paid` purchase and a consumed place, **for nothing**. No uuid guessing, no
cleverness, no Stripe involved. The purchase id is not a secret; it is issued on request.

So `entries.record_checkout_event()` takes a key as its first argument, compared against a
SHA-256 digest held in `entries.webhook_secrets` — a table with RLS on, no policy and no grant,
like every other table in the schema. **The grant on the function is still `to anon` and
nothing else**, which is what the brief asked for; the key is an argument, not a grant.

| | |
| --- | --- |
| **Where the key lives** | `ENTRIES_WEBHOOK_KEY`, a Worker secret set with `wrangler secret put`. Never in this repository, never in `wrangler.jsonc`, never in a `vars` block |
| **What the database holds** | The SHA-256 digest and never the key. A leak of the table yields a hash of 32 random bytes |
| **Why the comparison need not be constant time** | A perfect timing oracle would reveal the *digest*, which is already assumed public, and leave an attacker needing a preimage |
| **How it ships** | With a **null digest**, which refuses everything. The same shape as `STRIPE_SECRET_KEY` being unset: a real, safe state rather than a placeholder that half works |

### The two alternatives considered

**A dedicated Postgres role** reached with a hand-minted JWT was the other way to close it. It
is the least boring thing available in a repository whose stated rule is *boring beats optimal*:
it rests on unverified assumptions about a hosted platform (that legacy HS256 signing still
works on this project, that a `grant ... to authenticator` survives an upgrade), the failure
mode if either breaks is **silent**, and a long-lived bearer token with no expiry is a
credential nobody will remember exists.

**The service role key** is not on the table and this record does not put it there. It would
close the hole and it would put a credential that bypasses every policy into a Worker, which
[the principles](../architecture/principles.md) rule out and this slice found no reason to
revisit.

## Consequences

**Good**

- The only object that writes `paid` requires a secret the published anon key does not carry.
- Not one character of `entries.create_pending_purchase()` changes, so the concurrency proof
  that protects a 250-place race is untouched.
- Applying the same event twice leaves one paid purchase, and the second delivery says so —
  which is what will stop Slice D sending two confirmation emails.
- A payment that arrives late is never refused, and the club finds out from the system.

**Bad, and accepted**

- **A second Worker secret and a manual SQL step.** Installing the digest cannot be a migration,
  because the key must not be in the repository. It is one row in
  [the manual steps](../../../platform/apps/main/README.md#manual-steps), and there is a
  rotation window — between updating the secret and updating the digest, every delivery answers
  5xx and Stripe retries. Minutes against a three-day retry window loses nothing, but a
  volunteer who does one and forgets the other stops payments being recorded with no symptom
  except a log line.
- **The alarm is a log line and a column.** There is no alerting stack and no email until Slice
  D. The row carries the flag durably and the five-minute cron shouts about it with an age that
  climbs, which is the best this platform can do today — and it is deliberately silenced only by
  a human setting `attention_resolved_at`, never by the calendar.
- **A free place still cannot be completed.** Stripe refuses a zero-total session, so a visually
  impaired runner's guide is still told so plainly. Unchanged by this slice, and still worth
  resolving before entries open.

**Neutral**

- `entries.entry_completion_state()` returns one word. A confirmation reads better with an
  amount on it, and *which* of three published prices a named person paid says whether they are
  affiliated — so minimisation won, and the person already knows what they paid.
- The over-capacity flag is **not** shown to the runner. The page says `paid`, which is true; a
  human from the club makes contact. Telling somebody from a web page that they may not have a
  place produces the phone call the alarm exists to prevent, before the club has decided
  anything. This is a judgement call and it ships as one.
