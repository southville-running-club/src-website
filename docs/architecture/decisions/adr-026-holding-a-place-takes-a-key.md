# ADR-026 — Holding a place takes a key, and a place that costs nothing is not held

**Accepted**, 31 August 2026.

| | |
| --- | --- |
| **Requirement** | [C3](../../foundations/requirements.md#c3--accept-race-sign-ups-and-entries) |
| **Relates to** | [ADR-010](adr-010-webhook-writes-paid.md), [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-021](adr-021-a-place-can-be-given.md), [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) |
| **Supersedes** | Nothing. It **adds a Worker secret** and **makes a zero total a database refusal** |
| **Issue** | [#178](https://github.com/southville-running-club/src-website/issues/178) |

## Context

**Anybody could hold all 250 places, for nothing, in under a second.** Found in the go-live
readiness review on 31 August 2026 and reproduced against a local stack:

```
249 anonymous holds in 0.5s (473/sec)   field now: 250 / 250
attacker paid: £0                        real runner: { ok: false, reason: 'sold_out' }
```

Three facts, each correct on its own, composed into it.

**`entries.create_pending_purchase()` is granted to `anon`, and it has to be.** There is no API
tier between the browser and Postgres, and a signed-out runner reaches PostgREST as `anon`. That
grant is the ordinary entry path, not an oversight — it is on the thirteen-function list
`packages/db/tests/entries.test.ts` has asserted since Slice B.

**It holds a place before any money moves.** The hold is 31 minutes, which is Stripe's floor
rather than the club's: the Worker sets the Checkout session's `expires_at` to the same
timestamp so the hosted page and the held place lapse together. Nothing is charged at hold time,
by design — which is exactly what made the attack free.

**A live `pending` hold counts against the 250**, which it must. Excluding it would sell the
same place twice.

**Cloudflare's rate-limiting rule never saw any of it.** C1 in
[the WAF rules](../../reference/cloudflare-waf-rules.md) covers `POST` under `/account/`,
`/admin/` and `/nn/`. PostgREST is a different origin, and its URL is in the same page source as
the key. **A per-IP limit in the Worker protects the path the attacker will not use** — which is
why "add rate limiting" was not, on its own, the fix.

**The confirming half of this had been closed since Slice B and the holding half never was.**
`entries.record_checkout_event()` takes a key, on the argument written into
`worker/index.ts` that *"without a second factor, two ordinary PostgREST calls would buy a free
race entry"*. That sentence was about both halves. Only one of them was ever built.

### What was not wrong

The readiness review found this and nothing else on the path. Consent enforcement in the
database, the minimum age to the day, fee gating for `tester` and `complimentary`, discount-code
scoping, row-level security on all ten `entries` tables, and the whole payment path under
tampering, wrong currency, replay and a second payment intent all held. This is one gap in an
otherwise sound design, and the change is scoped to it.

## Decision

### 1. Holding a place takes the entry key

`entries.create_pending_purchase()` gains `p_key`, checked as the **first statement in the
body** — before the event is looked up, so a caller without the key cannot use the function to
learn which events exist, whether the window is open, or how many places are left. A slug nobody
created answers `unauthorised`, exactly as a real one does.

The key is `ENTRIES_ENTRY_KEY`, a **Worker secret**: never in this repository, never in
`wrangler.jsonc`, never in a `vars` block. The database holds only its SHA-256 digest, in
`entries.webhook_secrets` under `entry`. This is the shape `record_checkout_event()` and the five
admin reads already use; it is not a new mechanism.

**A third row rather than a second use of the webhook key.** One key that opens two doors is one
rotation that closes both, and these two secure different moments: one confirms a payment, the
other holds a place before there is a payment at all.

### 2. The anon grant stays

**The readiness note proposed revoking it. That would have broken real entries.** The Worker has
no service role key and must never have one, so its signed-out path *is* an `anon` call —
revoking the grant would refuse every signed-out runner along with every attacker.

What separates the Worker from a script is not which role it reaches Postgres as. It is that the
Worker holds a secret. So the grant list is **unchanged at thirteen**, and what changed is how
many of those thirteen demand a key: **six became seven**.
`entries.test.ts` now asserts that second list too, because the grant list alone says what `anon`
may *ask* and never which asks are protected.

### 3. The digest ships null, which refuses everything

The same shape as an unset `STRIPE_SECRET_KEY`: a real deployment state that says *"not connected
yet"* rather than a placeholder that half works.

**The alternative was considered and rejected.** Treating a null digest as *"not armed yet,
allow"* would have kept the deployed Worker working straight through the deploy — and left this
open on any day somebody forgot the secret, with a forgotten install looking exactly like a
working one. Everything in this repository fails towards taking no money; a control that fails
towards being off is not one.

The Worker checks the binding **before** it calls, so an unbound key renders the same page an
unset Stripe key does — *nothing has been stored and nothing has been charged* — rather than
turning a known deployment state into a refusal that reads as a defect.

### 4. A total of zero is refused, in the database

Stripe cannot take a payment for £0, so a place at £0 is a place that can never be completed: it
sits out of the 250 until it lapses. The Worker has refused a free fee since Slice A and catches
a hundred-per-cent discount code on the way back — **but neither rule was in the database**, so
neither applied to a caller that never met the Worker.

This is the house rule that Zod is never the only place a rule lives, applied to the last rule on
this path that was still only in TypeScript. It is checked **after** every other rule, so a free
entry from somebody under 18 still answers `under_age` — the more useful sentence, and what it
answered before.

### 5. `vi_guide` keeps its price and its visibility

**A change of plan from the readiness note, which proposed gating the £0 fee behind
`requires_permission` the way `complimentary` and `tester` are gated.**

It would close nothing the key does not already close — the £20 `unaffiliated` fee floods
identically, because no money moves at hold time either way — and it would cost something real.
Since [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) took the VI guide entry type off
the form, that fee row is the **last remaining subject of the Worker's free-place backstop**.
Gating it would drop the fee out of `entry_state()`, make a crafted request fail at parse time
instead, and retire a tested refusal in order to re-close a door this ADR bolts.

Refusing a zero total covers the £0 fee, a future hundred-per-cent code, and any other route to a
free total, without touching what the form offers.

## Consequences

**This refuses the deployed Worker until the secret is installed**, which is a break rather than
an expansion, and it is taken deliberately with the window shut. `entries_open_at` is null on
`nn-2026` and the committee agreed on 31 August 2026 to hold it there until this is deployed, so
no runner can reach the function at all — `entry_state()` and `create_pending_purchase()` both
answer `closed` while that column is null. The only caller who could notice is somebody holding
`nn.entry.before_open`.

⚠️ **The order is not negotiable: install the secret, verify it, then open the window.** Doing
it the other way round is a window that is open and unprotected, which is the whole of #178. The
[entries-open runbook](../../delivery/runbooks/entries-open.md) owns both steps and the
verification between them.

**This is the second migration in this repository to drop a function**, and for the same reason
as the first. `create or replace` with a different argument list does not replace anything — it
creates a second overload, and PostgREST then refuses every call that could match either one as
ambiguous. `20260828140000_entries_discounts_and_guides.sql` set the precedent when it added
`p_preview`.

**A per-IP limit in the Worker becomes worth having, and it is not built here.** With the
database reachable only through the Worker, Cloudflare's C1 starts applying to this path and a
per-IP hold limit would mean something. Neither is in this change.

**A distributed attempt is still untouched.** Rationing holds globally per event — refusing more
than *n* live holds per event per minute regardless of source — would answer it, and it is a
decision about how a sell-out morning should behave rather than a defect. It is deliberately not
taken now: the race sold out in 2023, and a global limit set too low refuses real runners on the
one morning that matters.

**The hold stays at 31 minutes.** It is Stripe's floor, not a tuning knob — the Checkout
session's `expires_at` is set to the same timestamp, so shortening it risks every real submission
failing at once.
