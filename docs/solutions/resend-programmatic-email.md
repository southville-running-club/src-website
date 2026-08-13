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
