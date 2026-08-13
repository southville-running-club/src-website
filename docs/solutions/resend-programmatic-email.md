# Programmatic email with Resend

Design for **Problem 2** in [email](email.md#problem-2--programmatic-mail): the automated
mail an entry form or sign-up sends back to a member. Not a decision by itself — it fills
in the detail that document left open once the five Fasthosts role addresses were chosen,
and it should be read alongside it, not instead of it.

---

## The five addresses, and which problem each belongs to

Five Fasthosts mailboxes, agreed: **`admin`, `info`, `welfare`, `secretary`, `payments`**.
All five are [Problem 1](email.md#problem-1--human-mailboxes) — real mailboxes, read by a
person, replied to from Gmail via *Send mail as*. `admin` is already in use for website
administration. The other four are new.

**None of the five should be the `From` address on automated mail.** That is the mistake
[email.md](email.md#two-problems-and-one-purchase-will-not-solve-both) already names:
mixing programmatic volume into a human inbox's sending reputation risks the mailbox that
holds it. Resend sends *as* the club without going anywhere near these mailboxes — it needs
its own identity, on its own subdomain, and the two only meet at `Reply-To`.

| Fasthosts mailbox | Who reads it | Resend touches it? |
| --- | --- | --- |
| `admin` | Web/tech admin | No |
| `info` | General enquiries | Only as a `Reply-To` target |
| `welfare` | Welfare officer | Not by default — see below |
| `secretary` | Club secretary | Not by default — see below |
| `payments` | Treasurer | Not by default — see below |

`info` is the right general-purpose `Reply-To` for anything that does not obviously belong
to one of the other four — that is what "generic access" means in practice: a human reads
replies there, not that Resend sends as `info@`.

### Should `info@` just be the one `Reply-To` for everything Resend sends?

Worth deciding explicitly, because the alternative — routing replies to `payments@` for
entry confirmations, `welfare@` for welfare-flagged mail, `info@` for the rest — is more
precise but also more to keep straight across every template, and a mistake there is a
reply landing nowhere anyone checks.

**Defaulting every automated `Reply-To` to `info@` is the simpler, safer starting point.**
`info` is explicitly the generic-access mailbox and is genuinely read by a person — a
member who hits "reply" on a confirmation email is not choosing a department, they are
replying to "the club", and `info@` is what that maps to. Routing straight to `payments@`
or `welfare@` only pays off once a specific flow (a failed payment, a welfare disclosure at
sign-up) is common enough that skipping a forward from `info` actually matters. Until then,
one destination for all Resend replies is one fewer thing to get wrong, and `info@` reads
naturally as "the club replied."

**Start with `info@` as the only `Reply-To`.** Move a specific flow to its own mailbox only
once volume or sensitivity (welfare disclosures, in particular) makes a direct line worth
the extra template complexity — treat that as a later, deliberate change, not part of this
design.

---

## What Resend actually sends as

**A dedicated sending subdomain**, per email.md's existing recommendation:
`send.southvillerunningclub.co.uk`. Not `mail.` — that is the MX target for the mailboxes
above — and not the bare domain, so a bad run of application mail can never touch the
domain's core SPF/DKIM/DMARC posture.

The `From` address is chosen per context, not per mailbox:

| Context | Suggested `From` | `Reply-To` |
| --- | --- | --- |
| Nightingale Nightmare entries | `nn@send.southvillerunningclub.co.uk` | `info@` |
| Pass the Buck entries | `pass-the-buck@send.southvillerunningclub.co.uk` | `info@` |
| General sign-up / intake forms | `noreply@send.southvillerunningclub.co.uk` | `info@` |

(See [below](#should-info-just-be-the-one-reply-to-for-everything-resend-sends) for why
every row defaults to the same mailbox rather than routing per context.)

This is what makes automated mail "look like it's from `nn` or `pass-the-buck`" without
inventing new mailboxes: the display name and local part are chosen by the sending code,
Resend just needs the subdomain verified once. Adding a new race or form later is a code
change (a new `From`), not a new DNS record or a new Fasthosts purchase.

**Set the display name too** — `From: "Nightingale Nightmare" <nn@send.southville...>` —
since that is what most inboxes actually show.

---

## DNS: additive only

Verifying `send.southvillerunningclub.co.uk` in Resend adds records under that subdomain.
None of it touches an existing record — this is [Move
1](dns-and-domain.md#move-1--add-a-record-no-risk) in the DNS document, no risk, reversible
by deleting the records.

- **SPF**: an `include:` added to the zone's *existing* record, not a replacement —
  `v=spf1 mx a include:_spf.livemail.co.uk include:_spf.resend.com/amazonses.com ~all`
  (Resend publishes the exact value at verification time). Mind the **10-DNS-lookup
  limit** — email.md already flags dropping the unused `a` mechanism to make room.
- **DKIM**: one or more CNAMEs Resend provides, scoped to the `send.` subdomain, e.g.
  `resend._domainkey.send.southvillerunningclub.co.uk`.
- **DMARC**: the existing `_dmarc` TXT at `p=none` already covers subdomains by default
  (no `sp=` override in the current record) — no change needed there.

The exact record values come from Resend's dashboard at verification time and should be
captured in this document once known, the same way the current zone is captured in
[current state](../foundations/current-state.md#dns-and-email).

---

## Free tier: will it work?

**Yes, to start**, per [email.md](email.md#problem-2--programmatic-mail)'s existing
figures — 3,000/month, but a **hard cap of 100/day** is the number that actually matters.
Five sending identities share one account-wide cap, not one each, so `nn@`, `pass-the-buck@`
and any future `noreply@` all draw from the same 100.

That is comfortable most of the year and tight on a single entry-rush day (email.md cites
~150 solo Nightingale Nightmare entries as the scenario that could hit it). **Check actual
sent volume before this is built** — the club's Gmail accounts already show typical daily
mail counts.

**If the cap becomes a recurring problem, the answer is Resend's own paid tier** (from
around $20/month at time of writing — verify on Resend's pricing page before committing),
not a second provider. email.md names Amazon SES as an alternative, and it is one, but it
trades a five-minute pricing decision for a second account, a second set of DNS records, a
sandbox-exit request, and a second thing that can misconfigure — real complexity for a
club run by two volunteers. **Paying Resend more is the boring answer**; adding SES is the
one that looks free and isn't, once the setup and ongoing upkeep are counted. This design
therefore treats Resend as the only provider, and does not plan a migration.

---

## What happens to a send that hits the cap on the day

Two different questions, easy to conflate: what fixes the cap going forward, and what
happens to the one email that got rejected today, before any capacity change has happened.
Upgrading the Resend plan answers the first. It says nothing about the message that
Resend's API returned a `429` for an hour ago — and until the club actually needs to pay
for capacity, this is the part that matters day to day.

**Don't drop it.** The failure mode of a silently-lost entry confirmation is a member who
paid and never got told it worked — indistinguishable, from their side, from the club
losing their entry. That is worse than a late email.

**Don't retry inline against the request either.** The signup or entry handler that
triggers the send is answering a browser request; it cannot sit there retrying against a
rate limit that will not clear for hours. Sending has to be decoupled from the request that
caused it.

**Don't fall back to a human mailbox's SMTP either** — see
[below](#why-not-just-send-from-info-or-another-human-mailbox). It reintroduces the exact
shared-failure risk the whole Problem 1 / Problem 2 split exists to avoid, and it would do
so on the one day volume is highest.

**The shape that fits what the club already has:** an outbox table in the same Postgres
database, written to in the same transaction as the entry or sign-up row, with RLS
restricting it exactly as
[principles](../architecture/principles.md) already requires for every table. A row per
attempted send, holding recipient, template, and a status — `pending`, `sent`, `failed`.
The application never calls Resend directly from the request path; it writes the outbox row
and returns. A scheduled Worker — [`./dev` already runs on Cloudflare's
platform](../../platform/README.md), and a Cron Trigger is the same primitive already used
elsewhere — drains `pending` rows through Resend a few at a time, and stops for the day the
moment Resend returns `429`, leaving the rest `pending` for the next run. Resend's daily cap
resets on a rolling basis, so the next run picks up where the last one stopped.

This is not new machinery bolted on for the cap specifically — it is the same
transactional-outbox shape most reliable send-on-signup systems use regardless of provider
limits, because "wrote the row, then the process died before the network call" is a
failure mode on any provider. The 100/day cap just means the schedule sometimes empties
into the next run instead of the same hour's.

**What this buys, restated:**

- Nothing is silently lost. A rejected send is `pending`, not gone.
- A member's confirmation might arrive a few hours late on the club's busiest day, rather
  than never.
- **One provider throughout.** The outbox is what absorbs a bad day — no second account,
  no second set of DNS records, no migration to reason about.

**What this is not:** a queue that lets the club live with a cap it has permanently
outgrown. If `pending` rows are routinely still queued the next day, that is the trigger to
pay for a higher Resend tier, not to keep widening the queue.

---

## The outbox, in depth

**This is design, not a build decision.** A table that stores a recipient email address is
new storage of personal data, which this repository's CLAUDE.md treats as a committee call
("Adding a database column that holds personal data is a committee decision"), not
something to migrate in on its own authority. Nothing below should be turned into a
migration without that sign-off — it exists so the sign-off is asking about a concrete
shape rather than a vague one.

### The shape of the table

Following the pattern the first real table already set in
[`intake.nn_interest`](../../platform/packages/db/supabase/migrations/20260809180000_create_intake_nn_interest.sql)
— narrow columns, RLS on from the first migration, no policy until the flow that needs it
exists to test it:

```
intake.email_outbox
  id            uuid, primary key
  to_email      text, not null
  from_identity text, not null   -- 'nn' | 'pass-the-buck' | 'noreply', not a free-form From
  template      text, not null   -- which email this is, e.g. 'nn-entry-confirmation'
  template_data jsonb, not null  -- the fields the template needs — no more than that
  status        text, not null, default 'pending'  -- 'pending' | 'sent' | 'failed'
  attempts      int, not null, default 0
  last_error    text             -- Resend's error, for 'failed' rows a person needs to see
  created_at    timestamptz, not null, default now()
  sent_at       timestamptz
```

**`template_data`, not a rendered email body.** Storing the finished HTML would duplicate
whatever the template already encodes; storing the inputs keeps the row small and keeps the
template itself (wording, branding) a code change reviewed like any other, not a stored
artifact that drifts from what actually ships.

**No content beyond what an entry confirmation already needs** — this table should not
become a place a fifth field quietly arrives. If a future template wants more than the
entry row it was built from already has, that is the same committee conversation as adding
a column to `intake.nn_interest`, not a smaller one because it's "just for email."

### Who is allowed to touch it, without a service role key

This is the part worth being explicit about, because it's the part most likely to be
solved by reaching for the one credential this repository has ruled out.

**The insert is easy — it rides the request that's already authenticated.** Whatever
policy lets the anonymous client insert the entry or intake row in the first place
(`intake.nn_interest`'s anonymous-insert policy is the existing example) is extended to
insert a matching `email_outbox` row **in the same transaction**, most naturally via a
`security definer` Postgres function the entry-submission endpoint already calls — the
function is trusted by what it does (insert exactly one outbox row per entry), not by who
is calling it, so it needs no new client-side privilege at all.

**Draining it is the hard part**, because a scheduled Worker has no browser session and no
user to be. It needs to read every `pending` row regardless of who inserted it, and update
`status` afterwards — by definition, more access than any single anonymous or authenticated
client should have to another person's row. Three ways to get there without a service role
key, roughly in order of preference:

| Approach | How it works | Trade-off |
| --- | --- | --- |
| **A dedicated Postgres role for the Worker** | A migration creates a role (not `service_role`) with a narrow grant — `select`/`update` on `intake.email_outbox` only — and an RLS policy on that table naming the role explicitly. The Worker authenticates to Postgres directly (not through PostgREST/anon) using a connection string in a Worker secret, scoped to that role by the database's own permissions | The credential is a Postgres password, not the platform-wide service role key — a leak exposes one table, not every table RLS was protecting. Needs a direct Postgres connection from the Worker rather than the Supabase JS client, which is a new pattern for `apps/main` |
| **A real Supabase Auth "service account" row** | One genuine `auth.users` row (e.g. `email-worker@southvillerunningclub.co.uk`, a real address the club controls), signed in once to get a long-lived session, refreshed by the Worker via the Supabase JS client like any authenticated user. RLS policies check `auth.uid() = '<that fixed id>'` on `email_outbox` only | Stays entirely inside the anon-key-plus-RLS model already used everywhere else — no new connection type, no new secret shape. Costs one more row in `auth.users` to reason about, and a refresh-token secret to rotate if it leaks |
| **A signed, narrowly-scoped custom claim** | A Postgres function issues a short-lived JWT carrying a custom claim (not `service_role`) that a policy checks, minted only for the Worker's own request | Most flexible, but it's inventing new auth machinery for one Worker job — the kind of unusual choice [principles](../architecture/principles.md) already warns is a tax on whoever maintains it next |

**The Supabase Auth service-account row is the boring answer**, consistent with "boring
beats optimal": no new connection type, no new claim scheme, just one more authenticated
user whose only privilege is this one table. It should still go through the same review as
every other RLS policy, with the negative case tested explicitly — an anonymous client, and
a different authenticated user, must both fail to read or update `email_outbox` rows that
are not theirs. That failing test is worth more than the passing one, per this repo's own
testing guidance.

### The scheduled Worker's job

A Cloudflare Cron Trigger — the platform already runs on Workers, this is a new trigger
type on the existing `apps/main` Worker rather than new infrastructure. Its job each run:

1. Select `pending` rows, oldest first, in a small batch (a handful at a time, not all at
   once — Resend still has a per-request behaviour worth respecting even under the daily
   cap).
2. For each row, call Resend. On success: `status = 'sent'`, `sent_at = now()`. On a `429`:
   stop the run entirely — the daily cap is account-wide, so there is no point trying the
   next row — and leave every remaining row `pending` for the next run. On any other
   failure (bad address, template error): `status = 'failed'`, `attempts += 1`,
   `last_error` recorded, and move on to the next row — this is not a capacity problem and
   should not stop the batch.
3. Log a count — sent, still pending, newly failed — so a run that quietly does nothing is
   visible rather than silent.

**Failures that are not capacity should not retry forever.** A `failed` row past a small
attempt limit (two or three) is a data problem — a malformed address, a template bug — not
something a fourth retry fixes. Past that limit it should stop retrying and just stay
visible as `failed` for a person to look at, the same way the negative-case testing
philosophy treats an assertion failing as more informative than one that silently passes.

### "Resend in the morning if it failed"

This falls out of the design above rather than needing separate machinery: a `429` doesn't
mark anything `failed` — it leaves the row `pending`, and `pending` rows are exactly what
the next scheduled run picks up. So the concrete answer to "how do we resend in the
morning" is: **run the Cron Trigger more than once a day**, and the morning run is just the
next ordinary run, doing what every run does — drain whatever's `pending`.

A sensible cadence, given the club's actual traffic pattern:

| Run | Purpose |
| --- | --- |
| Every 15–30 minutes during the day | Keeps confirmation emails close to real-time on an ordinary day |
| One run early the next morning | Specifically catches whatever was still `pending` at midnight because the cap was hit the day before — this is "resend in the morning" |

Both are the same Worker, the same code path, the same table. There's no special
"morning retry" logic to build — the morning run is just another tick of the same cron,
and it does the right thing because `pending` rows don't expire or get abandoned between
runs. The only thing worth deciding is the cron expression, which is a one-line config
change, not a design decision.

**One thing to watch: rows should not silently age past being useful.** An entry
confirmation delayed by five hours on a rush day is fine; one still `pending` after three
days means something is stuck — wrong Resend key, a template that always errors, a
Worker that stopped being deployed. A `pending` row older than, say, 24 hours is worth
surfacing (even just as a manual `select` a volunteer runs, not necessarily an alert) so
that "the outbox is silently not draining" doesn't look identical to "everything's fine."

---

## Why not just send from `info@`, or another human mailbox?

Worth answering directly, since it looks like the simplest option — no new provider, no
new DNS, just point the application at the mailbox it already has credentials for once
Fasthosts mailboxes exist.

**It isn't best practice, and email.md already sets out why**, precisely because this
question comes up naturally: [mailbox
SMTP](email.md#two-problems-and-one-purchase-will-not-solve-both) has low rate limits, no
bounce or complaint handling, and — the part that matters most here — **a shared failure
mode**. If application mail exhausts the mailbox's sending limit, the committee loses their
own inbox at the same time. That risk is highest on exactly the day it would be worst:
Resend's 100/day cap and Fasthosts mailbox limits both bite hardest during an entry rush,
which means falling back to `info@`'s SMTP on a capacity day would put the club's actual
human inbox at risk *because* application volume was high — the opposite of what a
fallback should do.

Concretely, for the mailboxes this design already assumes:

- **Fasthosts' publishable sending limit is unconfirmed** (email.md flags it as something
  to check on the upgrade page), and the closest costed comparison — Migadu Micro — sends
  **20 messages a day across the whole account**, well under Resend's free tier.
- **No bounce or complaint webhooks.** Resend tells the application when a send failed;
  mailbox SMTP does not, so a bounced entry confirmation would go unnoticed rather than
  landing in the outbox as `failed` for someone to check.
- **SPF/DMARC get muddier, not cleaner.** The mailbox route works only by literally
  authenticating as the mailbox — there is no equivalent of Resend's per-identity `From`
  (`nn@`, `pass-the-buck@`) without either sharing one mailbox's credentials across every
  send context or provisioning a mailbox per race, which is the ten-mailboxes-for-a-
  committee-of-few problem email.md already ruled out.

**Where a human mailbox is the right tool** is exactly what it's already used for in this
design: `Reply-To`. A member's reply after an automated send should land somewhere a
person reads it — that's `info@`'s job, not sending.

---

## What this is not

- **Not a mailbox purchase.** Buying `info`, `welfare`, `secretary`, `payments` at
  Fasthosts is [Problem 1](email.md#problem-1--human-mailboxes) — its own decision, its own
  ~£26–33/yr, unrelated to Resend's £0.
- **Not a code change yet.** This is the design; wiring a Resend send call into an entry or
  intake handler, and adding `RESEND_API_KEY` as a Worker secret, is separate work once the
  sending subdomain is verified.
- **Not touching the timing platform.** `pass-the-buck` and `nn` here are sending
  *identities* for club-site confirmation email, not `src-race-timing` — that stays
  untouched per [principles](../architecture/principles.md).

---

## If this were decided

| | |
| --- | --- |
| **Requirement** | [C8](../foundations/requirements.md#c8--send-email-as-the-club) |
| **Blocked on** | Choosing which four new Fasthosts mailboxes to buy (recorded above as `info`, `welfare`, `secretary`, `payments`) and verifying the `send.` subdomain in Resend |
| **Decision** | Resend, free tier, on `send.southvillerunningclub.co.uk`; `From` chosen per context (`nn@`, `pass-the-buck@`, `noreply@`); `Reply-To` defaults to `info@`; a Postgres outbox table + scheduled Worker absorbs any day the 100/day cap is hit |
| **Cost** | £0, on top of the ~£30/yr already costed for the four mailboxes in [email.md](email.md#cost) |
| **Exit cost** | Low — no second provider to unwind. Upgrading capacity is a Resend plan change, not a migration |
| **Revisit when** | `pending` outbox rows are routinely still queued the next day — that's the trigger to pay for a higher Resend tier, not to add a second provider |
