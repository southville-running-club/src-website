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

### Options

Prices ex-VAT, captured August 2026, for the club's realistic shape.

| Option | Per year | DNS change | Assessment |
| --- | --- | --- | --- |
| **Keep forwarding** | £0 | — | Free, and fixes nothing |
| **Cloudflare Email Routing** | £0 | **Yes — MX** | Free and removes the Fasthosts dependency, but it is still forwarding, so the actual complaint survives |
| **Fasthosts Standard Email** — 2 mailboxes | **~£26–£33** | **None** | MX already points here. Intro pricing ~£1/mo rising to £2.19–£2.75/mo |
| **Fasthosts Exchange Basic** | ~£39/mailbox | None | Full Exchange mailboxes. More than the club needs |
| **Zoho Mail Lite**, 2 users | ~£19 | **Yes — MX** | Cheapest per user, good webmail. Saves ~£10/yr in exchange for repointing MX |
| **Microsoft 365 Business Basic** ×10 | ~£552 | **Yes — MX** | Priced for staff, not committees |
| **Google Workspace Starter** ×10 | **~£850 +VAT** | **Yes — MX** | **Four times the Squarespace bill.** Fails the [money constraint](../foundations/requirements.md#money) outright |

### The recommendation, and the reason is not price

> **Fasthosts Standard Email, two role mailboxes, ~£26–£33/yr — chosen because it requires
> no DNS change at all.**

The MX record already points at Fasthosts. Every alternative saves at most £10 a year in
exchange for repointing **the single riskiest record in the zone**, and [DNS and
domain](dns-and-domain.md#move-3--move-authoritative-dns-the-only-genuinely-risky-move)
sets out at length why that is not a trade worth making casually.

Zoho is genuinely the better product for the money. It is not worth touching MX for £10.

**Buy role addresses, not people.** Two to start — the club does not need ten mailboxes,
and per-person provisioning is how this turns into Google Workspace pricing. Scale only if
two proves too few.

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
| **Decision** | Two Fasthosts role mailboxes for human mail, used via Gmail *Send mail as*; Resend on a dedicated sending subdomain for application mail |
| **Cost** | ~£30/yr |
| **Consequences** | Replies come from the club, not a volunteer. Mail is SPF-aligned. A path to `DMARC p=quarantine` opens. Fasthosts dependency continues, but no deeper than today |
| **Exit cost** | **Low.** Mailboxes: export and repoint MX. Transactional: swap an `include:` and a set of DKIM records. Neither holds data the club needs to keep |
| **Revisit when** | The Resend 100/day cap is hit; a third role address is needed; or the club leaves Fasthosts entirely |

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
