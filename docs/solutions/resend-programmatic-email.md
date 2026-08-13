# Programmatic email with Resend

Design for **Problem 2** in [email](email.md#problem-2--programmatic-mail): the automated
mail an entry form or sign-up sends back to a member. Not a decision by itself — it fills
in the detail that document left open once the five Fasthosts role addresses were chosen,
and it should be read alongside it, not instead of it.

---

## Current status: backlogged, `info@` used directly in the meantime

**This design — Resend, the sending subdomain, the outbox — is not being built yet.** It
is recorded here so it exists as a concrete plan when it is picked up, not so it is acted
on now.

**In the meantime, `info@` is the programmatic sender.** This is a deliberate, temporary
exception to
[the recommendation later in this document](#why-not-just-send-from-info-or-another-human-mailbox)
against sending automated mail from a human mailbox — that recommendation still stands as
the target state, it just isn't where things start.

**Why this is an acceptable interim step, and when it stops being one:**

- There is **no live form or sign-up flow yet** —
  [`platform/README.md`](../../platform/README.md) is explicit that this is a skeleton,
  with "no sign-up form, no Stripe, no timing application code." Programmatic volume today
  is effectively zero, which is exactly the condition under which the shared-failure risk
  this document otherwise warns about doesn't yet bite.
- **It needs no new provider, no new DNS, and no new mailbox purchase** to unblock building
  an actual form now, rather than waiting on Resend account setup and subdomain
  verification first.
- **Revisit this the moment real volume exists** — the first live intake form is the
  trigger to build the Resend piece, not a later "when we get around to it." Sending
  application mail from `info@` at any real volume is exactly the failure mode
  [email.md](email.md#two-problems-and-one-purchase-will-not-solve-both) exists to prevent:
  a bad run of application mail taking the committee's own inbox down with it.

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

## DNS: additive only, and edited in Cloudflare now, not Fasthosts

**The nameservers moved on 8 August 2026** — Cloudflare is the authoritative DNS provider
now, per the executed
runbook](../delivery/runbooks/nameserver-move.md). That
changes *where* a record is added, not what adding one means: **mail routing itself did not
move** — the MX target, SPF's existing `include:`, the DKIM CNAMEs and the mailboxes all
still point at Fasthosts livemail, copied across unchanged. So these new Resend records go
into **Cloudflare's DNS dashboard**, and what they point at — Resend's infrastructure — has
nothing to do with Fasthosts at all.

Verifying `send.southvillerunningclub.co.uk` in Resend adds records under that subdomain.
None of it touches an existing record — this is [Move
1](dns-and-domain.md#move-1--add-a-record-no-risk) in the DNS document, no risk, reversible
by deleting the records. **One thing to carry over from the migration runbook: add them
DNS-only (grey), not proxied** — Cloudflare proxies HTTP/HTTPS only, and a proxied SPF/DKIM
TXT or CNAME simply doesn't behave as the record it's supposed to be.

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

## Account, API keys, and how a reply reaches `info@`

What actually needs creating, by whom, and what goes where. Two different kinds of
credential are involved and they should not be confused: **who can log into Resend's
dashboard**, and **what the Worker uses to call Resend's API**. Getting the first one wrong
is a governance problem — it's a fifth account reachable by one person, the exact complaint
[email.md](email.md#why-forwarding-is-not-good-enough) already raises about the current
forwarding arrangement. Getting the second wrong is a leaked-credential problem.

### The Resend account itself

**One club-owned account, not a personal login.** Sign up with a club address the
committee already controls — `admin@southvillerunningclub.co.uk` fits, since it's already
the address used for other website administration — not a volunteer's personal Gmail.
**Add both volunteers as team members inside Resend**, so neither leaving strands the
account the way the current Gmail-forwarding arrangement would strand club mail.
*(Verify whether team members are a free-tier feature or gated behind a paid plan before
committing to this — if Resend restricts it, the fallback is a shared login stored the same
way any other shared club credential is, not a single person's account.)*

No credit card is required to create a free-tier account, per Resend's published pricing —
worth reconfirming on the actual sign-up page, since pricing pages change.

### The API key — what the Worker actually holds

Resend authenticates over a plain HTTPS API, not SMTP, so **there are no mail-server
credentials to manage** — no username/password pair, no port, nothing analogous to the
`smtp.southvillerunningclub.co.uk` credentials Problem 1's mailboxes would use. There is
exactly one secret: **an API key**, a single opaque string Resend's dashboard generates.

**Scope it to sending only.** Resend lets a key be restricted to "Sending access" rather
than full account access (which can also read logs, manage domains, remove team members).
The Worker only ever calls the send endpoint, so it should hold a key that can do nothing
else — if it leaks, the blast radius is "someone can send email as the club," not "someone
can reconfigure the account."

**Where it lives:** a Cloudflare Worker secret, set with `wrangler secret put
RESEND_API_KEY` against `apps/main` — the same mechanism `PUBLIC_SUPABASE_ANON_KEY` in
[`wrangler.jsonc`](../../platform/apps/main/wrangler.jsonc) deliberately *isn't* used for,
because unlike the Supabase anon key, **the Resend API key is not meant to be public** —
it is a `PUBLIC_`-prefixed value that goes into committed config, and this is the opposite:
a Worker secret, encrypted at rest, never in a file the repository tracks. Locally, the
same pattern the Supabase local stack already uses — a `.dev.vars` file, gitignored, holding
a placeholder or a real key pointed at Resend's test mode (see below).

This is one secret, one scope, one place it lives — deliberately smaller than the
three-secret Supabase deploy arrangement [cloudflare-setup.md](../delivery/runbooks/cloudflare-setup.md)
already documents, because sending mail needs less trust than migrating a database.

### How a reply actually reaches `info@`

This is simpler than it might look, because **`Reply-To` is just a header** — it requires
no verification, no DNS record, and no relationship with Resend at all beyond Resend
setting the header on the message it sends.

1. The Worker calls Resend's send API with:
   - `from`: `"Nightingale Nightmare <nn@send.southvillerunningclub.co.uk>"` — must be on
     the *verified* sending subdomain, or Resend rejects the send.
   - `reply_to`: `"info@southvillerunningclub.co.uk"` — the club's real mailbox, on the
     main domain, entirely unrelated to what Resend has verified. Resend never sends *as*
     `info@`; it just tells the recipient's mail client "when this person hits reply, address
     it here instead."
2. The member receives mail that shows `From: Nightingale Nightmare <nn@send...>` — but
   hitting **Reply** in their mail client addresses the new message to `info@...`, per the
   `Reply-To` header, not back to `nn@send...`.
3. That reply is ordinary inbound mail to `info@southvillerunningclub.co.uk` — it travels
   over Fasthosts livemail exactly as every other piece of inbound club mail does today.
   Resend is not involved in receiving it at all; **Resend only ever sends**, it has no
   inbound role, so `info@` needs no Resend configuration whatsoever to receive replies.

**Nothing about this requires `info@` to exist in Resend, be verified by Resend, or be
known to Resend beyond being a string in a header.** The mailbox purchase
([Problem 1](email.md#problem-1--human-mailboxes)) and the Resend setup (Problem 2) really
are two independent purchases meeting only at that one header value.

### What needs deciding by a human, and written down

Per [how to work here](../../CLAUDE.md#how-to-work-here) — "any step done by hand is
written down" — the account creation itself is manual and should be recorded once done:

- Which club address signed up for Resend, and the date.
- Both volunteers confirmed as team members (or the fallback credential-sharing approach,
  if team members turn out to be a paid feature).
- The scoped API key's name/label in Resend's dashboard, so a future audit of "what can
  send mail as the club" doesn't require guessing which key is which.

---

## Step by step, get-go to a working send

**Two places now that the nameservers have moved, not three**: Resend's own dashboard
(account, domain, key) and Cloudflare, which does double duty — it's both where the DNS
records go **and** where the key and code live. Fasthosts isn't touched at all for this;
it stays the mail *server* the MX record already points at, but it hasn't been where DNS
records are edited since [8 August 2026](../delivery/runbooks/nameserver-move.md).

1. **Sign up at Resend** with the club-owned address, per
   [above](#the-resend-account-itself) — not a personal login.
2. **Add both volunteers as team members** in Resend.
3. **Add a domain in Resend**: `send.southvillerunningclub.co.uk`. Resend generates the
   SPF `include:` and DKIM CNAME values for it.
4. **Add those records in Cloudflare's DNS dashboard**, set to **DNS-only (grey), not
   proxied** — the new DKIM CNAMEs, and the existing SPF record extended with Resend's
   `include:`, never replaced. Purely additive — [Move
   1](dns-and-domain.md#move-1--add-a-record-no-risk), no risk to anything already working.
5. **Verify the domain in Resend.** It checks DNS has propagated — usually minutes,
   occasionally longer depending on the record's TTL.
6. **Generate an API key in Resend**, scoped to Sending access only.
7. **Store it as a Worker secret** — `wrangler secret put RESEND_API_KEY` against
   `apps/main`, plus a gitignored `.dev.vars` entry for local development.
8. **Write the send call** — a small function that `POST`s to Resend's API with `from`,
   `to`, `reply_to: info@southvillerunningclub.co.uk`, and the template content. This is
   the first actual code change; everything before it is account and DNS admin.
9. **Send a test message to a real inbox** and confirm the `From` name, that `Reply-To` is
   set, and that replying actually lands in `info@`.

**Steps 1–7 are account and DNS setup — no code.** Step 8 is the only build work needed to
send a single transactional email. The [outbox](#the-outbox-in-depth) is additional work on
top of that, worth doing once volume or the cap makes it worth it — it is not required to
send the first email, and shouldn't block getting one working end to end.

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

**Concretely, at the API level first.** Resend does not queue an over-cap send for you —
the 101st send that day gets a synchronous **HTTP `429`** back from the same API call,
immediately, with an error body identifying it as a rate-limit rejection. Every attempt
after that gets the same response until the cap resets, which Resend does daily — the
precise reset boundary is worth confirming against Resend's own docs once the account
exists, rather than assumed. **It also shows up in Resend's own dashboard** — rate-limited
sends appear in the logs there, so there is a second, independent place to notice it
happened, beyond whatever the club's own code records.

That immediacy is what makes the design below workable at all: the Worker learns *at the
moment it tries* that the cap has been hit, in the same request, not from a delayed bounce
it has to infer later.

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
| **Status** | **Backlogged.** `info@` sends programmatic mail directly in the meantime — see [current status](#current-status-backlogged-info-used-directly-in-the-meantime) |
| **Blocked on** | Choosing which four new Fasthosts mailboxes to buy (recorded above as `info`, `welfare`, `secretary`, `payments`) and verifying the `send.` subdomain in Resend |
| **Decision** | Resend, free tier, on `send.southvillerunningclub.co.uk`; `From` chosen per context (`nn@`, `pass-the-buck@`, `noreply@`); `Reply-To` defaults to `info@`; a Postgres outbox table + scheduled Worker absorbs any day the 100/day cap is hit |
| **Cost** | £0, on top of the ~£30/yr already costed for the four mailboxes in [email.md](email.md#cost) |
| **Exit cost** | Low — no second provider to unwind. Upgrading capacity is a Resend plan change, not a migration |
| **Revisit when** | The first live intake form ships (moving off `info@`), or once live, `pending` outbox rows are routinely still queued the next day (the trigger to pay for a higher Resend tier) |
