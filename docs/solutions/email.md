# Email

What it would cost to stop forwarding club mail into personal Gmail accounts, and how the
club's applications should send mail. Two questions that look like one.

[Options](options.md#c8--email) places email among the cheapest capabilities to change and
warns it should not influence larger decisions. That still holds — nothing here blocks or
is blocked by the hosting decision. It is written up separately because it carries a small
recurring cost and because getting the split wrong is expensive.

Baseline facts are in [current state](../foundations/current-state.md#dns-and-email); the
capability is [C8](../foundations/requirements.md#c8--send-email-as-the-club).

---

## Two problems, and one purchase will not solve both

| | What it is | What it actually needs |
| --- | --- | --- |
| **1. Human mailboxes** | Committee addresses that people read and reply from | Real mailboxes with authenticated SMTP |
| **2. Programmatic mail** | Magic links, entry confirmations, membership acknowledgements | A transactional service — bounce handling, complaint webhooks, reputation management |

**A mailbox provider cannot do the second job.** Mailbox SMTP has low rate limits, no
bounce or complaint handling, and no deliverability tooling. Worse, the failure mode is
shared: if application mail exhausts a sending limit, **the committee loses its inbox
too**.

Buying mailboxes to solve the programmatic problem is the mistake this document exists to
prevent. They are separate purchases, separate providers, and separate DNS records.

---

## What is true today

From the [zone capture](../foundations/current-state.md#dns-and-email):

- **Forwarding only.** Fasthosts livemail forwards club addresses to **Gmail accounts**.
  There are addresses on the domain but no mailboxes the club holds.
- **The MX target is inside the zone** — `mail.southvillerunningclub.co.uk` — so the
  `mail` A record is load-bearing for all inbound mail.
- **Four DKIM CNAMEs** for livemail, an SPF record of `v=spf1 mx a
  include:_spf.livemail.co.uk ~all`, and **DMARC at `p=none`** — monitoring, no
  enforcement.
- `smtp.southvillerunningclub.co.uk` already resolves to Fasthosts' outbound server. **The
  plumbing for authenticated sending exists; forwarding-only just does not issue
  credentials for it.**

### Why forwarding is not good enough

Worth stating precisely, because the precise reason determines the fix.

**Replies go out from a volunteer's personal Gmail address, not the club's.** This is the
part people notice, and for a limited company it is a credibility problem rather than an
inconvenience.

**Forwarding breaks SPF.** The forwarding server is not authorised by the original
sender's SPF record, so forwarded mail fails authentication. `p=none` means it degrades
into spam folders rather than bouncing — which also means **the club can never safely
tighten DMARC while it depends on forwarding**. That is a security posture frozen in place
by an email arrangement.

**No shared access, and no archive.** If a volunteer leaves, the forwarding destination
and every message in it leave with them. This is a fifth system reachable by one person,
and it does not appear on the [access
list](../foundations/current-state.md#accounts-and-access) because it looks like a DNS
record rather than an account.

---

## Problem 1 — human mailboxes

### The fix is smaller than it looks

Real mailboxes issue **authenticated SMTP credentials**, and those unlock Gmail's *Send
mail as*. Committee members carry on working in Gmail — no new interface, no new habit,
which matters more for volunteers than for staff — but mail leaves **from the club
address**, and it is SPF-aligned because it genuinely is sent through an authorised
server.

That is the whole fix. It does not require anybody to move, migrate, or learn anything.

### Cloudflare does not do this

Worth answering directly, because moving DNS to Cloudflare makes it a natural assumption.

| Cloudflare feature | What it is | Does it help? |
| --- | --- | --- |
| **Email Routing** | Free inbound **forwarding** to an address you already have | **No.** It is the club's current arrangement with a different logo — replies still come from Gmail |
| **Email Sending** | Transactional sending from a Worker, on the paid plan | **Not for humans.** It is the [C8](../foundations/requirements.md#c8--send-email-as-the-club) answer, not a mailbox |

**Cloudflare has no mailbox product.** There is nothing to log into, no IMAP, no archive.
Whatever happens to the club's DNS, **mailboxes have to come from somewhere else.**

### The club's shape is many addresses, few people

This is the thing that decides which provider is right, and it is easy to miss.

The committee has **around ten roles** — chair, secretary, treasurer, membership, welfare,
web, quarter master — and each wants an address. It does **not** have ten people who need
separate inboxes, and it never will.

**Almost every mail provider charges per user.** That prices a club as if it were a small
company, and it is why Google Workspace comes out at £850. A provider that charges a flat
rate regardless of mailbox count fits the club's actual shape far better.

### Options

Prices ex-VAT, captured August 2026. Costed at **two mailboxes now** and at **six role
addresses later**, because the difference between the pricing models only becomes visible
in the second column.

| Option | Two mailboxes | Six role addresses | DNS change | Assessment |
| --- | --- | --- | --- | --- |
| **Keep forwarding** | £0 | £0 | — | Free, and fixes nothing |
| **Cloudflare Email Routing** | £0 | £0 | **Yes — MX** | Still forwarding. Does not solve the complaint |
| **Migadu Micro** | **~£15** | **~£15** | **Yes — MX** | Flat rate, unlimited domains. Swiss; 5 GB. **Sends only 20 messages a day** — see below |
| **Migadu Mini** | ~£71 | ~£71 | **Yes — MX** | Same model, 200 sent/day. No longer cheaper than Fasthosts |
| **Zoho Mail Lite** | ~£19 | ~£57 | **Yes — MX** | Good webmail, per user |
| **mailbox.org** | ~£20 | ~£61 | **Yes — MX** | German, privacy-focused, per user |
| **Fasthosts Standard Email** | **~£26–£33** | **Unknown — check** | **None** | MX already points here. Intro ~£1/mo rising to £2.19–£2.75/mo. Cost beyond two mailboxes is not published |
| **Fasthosts Exchange Basic** | ~£78 | ~£234 | None | Full Exchange. More than the club needs |
| **Fastmail** | ~£96 | ~£288 | **Yes — MX** | Excellent product, priced per user |
| **Microsoft 365 Business Basic** | ~£110 | ~£331 | **Yes — MX** | Priced for staff, not committees |
| **Google Workspace Starter** | ~£142 +VAT | **~£425 +VAT** | **Yes — MX** | Fails the [money constraint](../foundations/requirements.md#money) outright |
| **Self-hosted mail server** | Server cost | Server cost | **Yes — MX** | **No.** Deliverability, spam, blocklists and patching, for a volunteer, on the club's most visible service |

**Migadu is cheaper for six addresses than Fasthosts is for two**, and the price does not
move as the committee grows. That is the pricing model matching the problem rather than
fighting it.

#### The catch on Migadu Micro: 20 messages sent per day

Not 200. **Twenty, across the entire account**, on the £15 plan.

That matters more than it looks, because the whole point of buying mailboxes is *Send mail
as* — so **every committee reply from a club address counts against it.** On a quiet week
that is ample. In a race-entry week, a membership renewal push, or any day somebody
answers a run of enquiries, it is not, and the failure mode is deferred or rejected mail —
precisely the problem the club is trying to leave.

| | Sent per day | Per year |
| --- | --- | --- |
| **Migadu Micro** | **20** | ~£15 |
| **Migadu Mini** | 200 | ~£71 |
| Zoho Mail Lite, per user | Several hundred | ~£19 for two, ~£57 for six |
| Fasthosts Standard | **Not published — ask** | ~£26–£33 |

**This should be checked against actual usage before committing**, and it is checkable:
the club's Gmail accounts already show how much mail goes out from club addresses in a
week.

**If 20 a day is too tight, the answer is not Migadu Mini at £71** — at that price the
flat-rate advantage has gone. It is **Zoho Mail Lite**, which is per-user but generous on
sending and costs about the same as Migadu Micro for the two or three mailboxes the club
actually needs today.

### So does it still make sense to use Fasthosts?

**It depends entirely on a decision that has not been made yet: whether the club keeps its
domain registered at Fasthosts.**

| If the registrar… | Then | Because |
| --- | --- | --- |
| **stays at Fasthosts** | **Fasthosts email is the right answer** | Fasthosts is a vendor and a bill either way. Adding mail costs no DNS change at all, and consolidating on a vendor you are keeping is worth more than £10 |
| **moves to Cloudflare** | **Migadu, or another independent provider** | Fasthosts would exist *solely* to hold email. Paying an otherwise-unused vendor to keep one service, at a higher price than the alternative, for a club trying to reduce vendor sprawl |

**Moving authoritative DNS to Cloudflare does not settle this**, which is the trap in the
question. DNS and registration are
[four separable things](dns-and-domain.md#four-separable-things) — the club can serve its
apex from Cloudflare while the domain stays registered at Fasthosts, and in that world
Fasthosts email remains sensible.

**So the order is: registrar decision → email decision.** Not the other way round, and not
both at once.

### The recommendation

> **Fasthosts Standard Email, ~£26–£33/yr — because it needs no MX change at all.**

The club is already committed to one mail-affecting change: moving the nameservers to
Cloudflare. **Every alternative provider adds a second one.** For two volunteers with day
jobs, removing an entire risky change from the programme is worth more than the £11–£18 a
year that the cheapest alternative would save.

**The flat-rate argument does not survive contact with the limits.** Migadu's model — pay
for volume, not people — is genuinely the better fit for a committee of many roles and few
humans, and at £15 it looked decisive. But [Micro sends 20 messages a
day](#the-catch-on-migadu-micro-20-messages-sent-per-day), which is the very thing the
club would be buying it for, and Mini at £71 costs more than Fasthosts. The advantage
evaporates.

*(Migadu was proposed first, on 7 August 2026, and dropped the same day once the send
limit was read properly. Recorded because the reasoning is more useful than a tidy
answer.)*

**Fasthosts also happens to be the low-risk sequence.** Buying mailboxes while Fasthosts
still controls the zone lets it configure its own mail records automatically; the club
then verifies mail works and copies **one settled, known-good zone** into Cloudflare. The
alternative is moving DNS and afterwards hand-adding records for a mail service in a
control panel that no longer controls the zone.

**What the club gets either way**: real mailboxes with authenticated SMTP, so committee
members keep working in Gmail via *Send mail as* but their replies leave from the club's
address, SPF-aligned.

**What is not on the table is Cloudflare**, because it does not sell mailboxes, and **not
self-hosting**, because running a mail server is the one piece of infrastructure where a
mistake is invisible to you and obvious to everyone who emails the club.

**Buy role addresses, not people.** Two to start — the club does not need ten mailboxes,
and per-person provisioning is how this turns into Google Workspace pricing. Ask whether
aliases onto those two cover the other committee roles; most mail hosts allow unlimited
aliases, and *Send mail as* can usually send from one.

### Revisit this if

- **Fasthosts will not say what its sending limits are**, or they turn out to be lower
  than Migadu's 20/day
- **Adding a third and fourth mailbox costs more than the whole Migadu plan** — the price
  beyond two is not published
- **The club moves the registrar away from Fasthosts.** At that point Fasthosts holds
  nothing else, the consolidation argument disappears, and this should be re-scored on
  merit

**Google Workspace should be ruled out in writing**, so it is not proposed again later by
somebody reasoning from what an organisation "normally" uses.

### Verify on the upgrade page before buying

The club's Fasthosts control panel is behind a login and these could not be confirmed from
public pricing. All five are load-bearing:

| | Why it matters |
| --- | --- |
| **The renewal price, not the headline** | Fasthosts' intro rate is roughly £1/mo and rises to £2.19–£2.75. Budget year two |
| **Authenticated SMTP submission (port 587) is included** | **This is the entire point.** A webmail-only plan does not solve the problem |
| **IMAP access** | So Gmail can pull mail in, and so phones work |
| **Mailboxes included, and cost per additional** | Decides whether "two role addresses" is the right starting shape |
| **Whether it is tied to the hosting package** | It should survive a DNS move — but confirm, given the club may later move DNS and registrar |

---

## Problem 2 — programmatic mail

[C8](../foundations/requirements.md#c8--send-email-as-the-club) covers membership
acknowledgements, entry confirmations, welcome messages and magic links.

| Option | Cost | Assessment |
| --- | --- | --- |
| **Resend** | Free — 3,000/month | Simplest to set up. **Hard cap of 100/day** on the free tier |
| **Amazon SES** | ~$0.10 per 1,000 | Effectively free at club volume — around 50p a year. More setup, including a request to leave the sandbox |
| **Postmark** | Free tier is 100/month | Too small to be useful; $15/mo entry tier is over budget |
| **The mailbox provider's SMTP** | Included | Rate-limited, no bounce handling, and couples app mail to the committee's inbox. **No** |

**Start with Resend**, with one caveat planned for: the free tier's **100/day cap**. With
around 150 solo entries at Nightingale Nightmare, a busy entry day could hit it. If it
does, **SES is the answer** — at club volume it costs pennies a year, and the only real
cost is setup.

### Two things to get right at setup

**Send from a subdomain.** Something like `send.southvillerunningclub.co.uk` — not
`mail.`, which is the MX target. This isolates the application's sending reputation from
the committee's, so a bad run of application mail cannot poison human email. It also keeps
the records separable if the transactional provider changes.

**Add to SPF, never replace.** The record is `v=spf1 mx a include:_spf.livemail.co.uk
~all`. A transactional sender needs its own `include:`, added alongside the existing one.
Two things to watch:

- **SPF has a 10-DNS-lookup limit.** `mx`, `a` and each `include` consume lookups.
  Exceeding it makes the record permanently invalid, which fails silently under `p=none`.
- **The `a` mechanism is already doing nothing useful** and should be dropped when the
  apex moves — see [DNS and
  domain](dns-and-domain.md#move-2--repoint-the-website-low-risk-fast-to-reverse).
  Removing it frees a lookup.

---

## Cost

| | Per year |
| --- | --- |
| Fasthosts Standard Email, two role mailboxes | ~£26–£33 |
| Resend, free tier | £0 |
| **Added to the club's platform spend** | **~£30** |

For comparison, the same problem solved by provisioning Google Workspace per committee
member is **~£850/yr**. The difference is entirely in refusing to conflate the two
problems and in buying role addresses rather than people.

---

## If this were decided

In the shape the [decision log](../decisions/decision-log.md) asks for, so it can be
lifted across when the committee agrees:

| | |
| --- | --- |
| **Requirement** | [C8](../foundations/requirements.md#c8--send-email-as-the-club), and the [shared ownership](../foundations/requirements.md#shared-ownership) constraint |
| **Blocked on** | **The registrar decision.** Fasthosts if the domain stays there; Migadu if it does not |
| **Decision** | Role mailboxes for human mail, used via Gmail *Send mail as*; Resend on a dedicated sending subdomain for application mail |
| **Cost** | **~£30/yr** at Fasthosts, **~£15/yr** at Migadu with unlimited role addresses |
| **Consequences** | Replies come from the club, not a volunteer. Mail is SPF-aligned. A path to `DMARC p=quarantine` opens |
| **Exit cost** | **Low.** Mailboxes: export and repoint MX. Transactional: swap an `include:` and a set of DKIM records. Neither holds data the club needs to keep |
| **Revisit when** | The Resend 100/day cap is hit; the committee wants an address per role; or the registrar moves |

### Sequencing, which differs by provider

The advice depends on which answer the club takes, and getting it backwards means two
mail-affecting changes instead of one.

| | |
| --- | --- |
| **Fasthosts mailboxes** | **Buy them before moving DNS.** Fasthosts will configure its own mail records automatically while it still controls the zone; the club then copies a settled, verified zone once |
| **Migadu or another provider** | **Treat the MX change as its own project.** Do it well before or well after the nameserver move — **never in the same week.** Two mail-affecting changes at once means an outage with two candidate causes |

Both routes want the same discipline: one change, one observation window, one thing to
blame if the phone rings.

---

## What this does not change

- **Not a migration.** MX stays where it is. No existing record is modified.
- **Not coupled to the hosting decision.** This can be actioned today or in six months and
  nothing else moves.
- **Not `DMARC p=quarantine` yet.** Tightening DMARC is the *reward* for getting off
  forwarding, not part of this change. Do it once real mailboxes are in use and reports
  are clean — and never during a DNS migration.
- **Not the newsletter.** Mailchimp keeps sending those; the site mirrors the archive. See
  [C14](../foundations/requirements.md#c14--publish-newsletters-and-club-documents).
