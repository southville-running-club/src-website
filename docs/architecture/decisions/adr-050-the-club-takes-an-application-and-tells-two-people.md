# ADR-050: The club takes an application, and tells two people

**Status:** Accepted
**Date:** 25 September 2026
**Supersedes:** nothing

## Context

The club has taken new-member applications through a Squarespace form for as long as it has had
a website. Eighteen questions — a name, a date of birth, a home address, a phone number, which
membership, and whether England Athletics may be given enough to set up a portal account.

[ADR-049](adr-049-what-membership-costs-lives-in-the-database.md) built the form on the club's
own site and deliberately left it **storing nothing and linked from nowhere**, because a table
holding that much personal data is a committee decision under this repository's own stop-and-ask
list, and not one an agent or a single volunteer takes.

**The club took it on 25 September 2026**, and asked for the whole path: somebody submits, they
get an acknowledgement, and the Membership Officer gets the filled form so they can process it.

⚠️ **This is not a new collection.** Every field is already asked on the club's live Squarespace
form today. What changes is who holds the answers, and that the club can see and delete them.

## Decision

**`membership.membership_applications` holds the application, and `membership.email_outbox`
holds the two messages it owes.**

### The email is not sent inline, and that is the whole shape

The obligation to send is written in the **same transaction** as the application —
[ADR-021](adr-021-the-club-tells-people-by-outbox.md). The alternative is the Worker calling
Resend at submit time, and then a provider that is down or rate-limited loses somebody's
application **silently**: they saw a confirmation page, the club never heard, and nobody finds
out until they turn up to a run expecting to be a member.

⚠️ **Resend's free tier is 100 emails a day, account-wide**, shared with every race and account
email the platform sends. On a busy day a membership acknowledgement is exactly the one that gets
refused. The outbox is what makes that **late** rather than **lost**.

So the queue holds an address and a pointer; every fact a message states is joined from the
application at send time. That is what stops it becoming a second copy for retention to chase.

### The two messages carry deliberately different amounts, and the query enforces it

`application_received` goes to the applicant: their first name, what they chose, what it costs.
`application_submitted` goes to `membership@southvillerunningclub.co.uk` and is the Membership
Officer's working copy — address, date of birth, phone number.

⚠️ **The split lives in `claim_outbox_batch()`, not in the templates.** It returns `details:
null` for the applicant's copy, so the acknowledgement renders from a row that **does not
contain** a home address. An edit to that template cannot leak one, because there is nothing
there to leak. A query returning both and a template choosing between them would be one careless
edit away from the opposite.

`Reply-To` is crossed over for the same reason it is set at all: on the club's copy it is the
**applicant**, so answering a new-member email reaches the new member.

### Two keys, and the table's anon grant is safe because of them

`submit_application()` is granted to `anon` — it must be, an applicant is signed out — and it
inserts a row and enqueues two emails. Without a key, a loop against the key printed in page
source fills the table and burns the club's entire daily email allowance in seconds.

⚠️ **This is [ADR-029](adr-029-holding-a-place-takes-a-key.md)'s finding applied before it was
needed rather than four days after.** `create_pending_purchase()` took 249 of 250 race places in
half a second from the published anon key. The only reason this path is not the same shape is
that it has no capacity to exhaust — it has a mailbox instead. Cloudflare's single rate-limiting
rule covers `POST` under `/account/`, `/admin/` and `/nn/`, **not `/membership/`**, and the free
plan allows exactly one rule, so there is no edge control here and will not be one.

The function may be called; the table may not be read. `membership.test.ts` attempts that read
with the published key and asserts `42501`.

### Every rule is re-checked in the database

The minimum age, the membership type and **the price** are all re-derived inside
`submit_application()`, whatever the caller sent. Slice G found `create_pending_purchase()`
trusting the form on a rule the database never checked, and two PostgREST calls bought an
affiliated place £2 under. Zod is the form's control, not the system's.

### Retention starts when a human acts, not when the application arrives

`processed_retention` is 90 days from `processed_at`. ⚠️ **An application still marked `new` is
never swept**, however old — it is outstanding work, and deleting it loses somebody who is
waiting to hear back. A sweep written against `created_at` is the obvious implementation and it
is the wrong one.

## Consequences

**The club owns its applicant data**, can see it, and can delete it — none of which was true of
the Squarespace form.

**Three outboxes now share one cron.** `drainMembershipOutbox` joins the entries and ticket
drains on the five-minute schedule, and is called from `ctx.waitUntil()` after a successful
submission so an acknowledgement goes in seconds — ADR-032. ⚠️ Removing the cron call makes a
failed send permanent.

**Two new Worker secrets**: `MEMBERSHIP_ENTRY_KEY` and `MEMBERSHIP_WEBHOOK_KEY`. Both ship
absent and both digests ship null, which refuses everything — the safe direction, and the reason
the form cannot take an application before the runbook installs them.

**`membership_state()` was dropped and recreated** to carry the England Athletics cut-off.
`create or replace` cannot change a return type, and the alternative was writing 1 April into a
Worker, which is wrong in April of whichever year England Athletics moves it.

**A good submission the club cannot record answers 422 and says nothing was stored.** It does not
reach the completion page. Somebody told their application arrived will not send it again, and
the club would never know it was missing — so the failure direction here protects the *answers*
rather than the money, which is the inversion from every `/nn/` path.

## What this does not decide

⚠️ **It does not decide the privacy-notice wording, and that is the one thing still owed before
the form is linked from anywhere.** `/privacy/` says nothing today about this collection, about
the retention period, or about passing a name, date of birth and email address to England
Athletics. Collecting a home address under a notice that does not mention one is a transparency
failure, not a paperwork one.

So `/membership/join/` still **stores** an application and is still **linked from nowhere**, and
the tests that assert that absence stay until the notice lands.

**It does not decide how membership is paid for.** No Stripe path exists here; the Membership
Officer arranges payment, which is what the club does today.

**There is no admin surface.** Nothing renders an application, and nothing marks one
`processed` — so the retention clock cannot start yet, and the notification email is in practice
the only readable copy. `/admin/membership/` is the obvious next piece.

**The emails are text only.** An HTML part renders from the same `MembershipOutboxMessage` and
never from the text's output, which is ADR-026's rule and ADR-041's after it — a separate change.
