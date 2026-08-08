# Cloudflare or Netlify

The [platform analysis](platform-options.md) narrows to two candidates. This is the
head-to-head, because the choice between them turns on a single question that is the
club's to answer rather than the analysis's.

**Everything else in the stack is identical either way** — Supabase Postgres in
`eu-west-2` for data, Stripe for payments, R2 or equivalent for files, Astro and
TypeScript for the build. Only the serving layer differs, and it is the cheapest layer to
change.

> **Superseded in part, 8 August 2026.** The nameservers moved to Cloudflare, so the
> constraint running through this document — *Cloudflare Pages only, via a CNAME at
> Fasthosts, because Workers custom domains need an active zone* — **no longer applies**.
> Everything new is a **Worker**, and attaching a custom domain creates its own DNS record.
>
> **The vendor analysis and the costings stand.** Kept as the record of how the choice was
> made. For what to do now, see [the phases](../delivery/phases.md) and
> [adding a hostname](../delivery/runbooks/adding-a-hostname.md).

---

## The one difference that decides it

| | Cloudflare | Netlify |
| --- | --- | --- |
| **Subdomain** (`nn.southvillerunningclub.co.uk`) from Fasthosts DNS | ✅ one CNAME | ✅ one CNAME |
| **Apex** (`southvillerunningclub.co.uk`) from Fasthosts DNS | ❌ **requires Cloudflare nameservers** | ✅ A record at Netlify |

That is the whole question. **Cloudflare cannot serve the club's apex without becoming
authoritative for the entire zone** — which means moving the domain's DNS, and carrying
club email with it. Netlify serves an apex from a plain A record and never touches the
zone.

Everything below is secondary to that.

---

## Cost, with email included

Both rows assume Supabase's free tier, Stripe for payments, and **two paid mailboxes** so
committee replies come from the club rather than a volunteer's Gmail — see
[email](email.md).

| | Cloudflare | Netlify | Today |
| --- | --- | --- | --- |
| Serving | **£47** *(Workers Paid — race night needs it)* | **£85** *(Personal — the free plan can stop serving)* | £204 |
| Database — Supabase free | £0 | £0 | included |
| Platform's cut on payments | **£0** | **£0** | £91 |
| Card processing — Stripe | £335 | £335 | £424 |
| Domain and DNS | £15.40 *(under £10 on Cloudflare Registrar)* | £15.40 | £15.40 |
| **Mailboxes** — two, at Fasthosts | £30 | £30 | £0 *(forwarding only)* |
| **Total a year** | **£427** | **£465** | **£735** |
| **Saved a year** | **£308** | **£270** | — |

**£38 a year separates them.** That is not a number to decide on, and this document exists
because the real difference is not price.

**Note the mailbox line.** Adding it costs £30 on *either* option, so it does not affect
the comparison — but it was missing from the [platform
tables](platform-options.md#the-complete-cost-picture) and is now recorded. It buys
something the club does not have today, so it is a new capability rather than a cost of
moving.

---

## Where they genuinely differ

| | Cloudflare | Netlify |
| --- | --- | --- |
| **Free-tier failure mode** | Requests beyond 100,000/day are rejected; the paid tier is £47 and lifts it to 10M/month | **Traffic stops** when the 300-credit monthly pool is exhausted, with no auto-recharge |
| **Apex from third-party DNS** | No | **Yes** |
| **DNS as code** | **Yes** — Terraform/OpenTofu against the Cloudflare zone | No — the zone stays in a Fasthosts control panel |
| **Cost of DNS** | **£0** | £15.40 stays at Fasthosts |
| **Object storage** | **R2 — 10 GB free, no egress charge** | Netlify Blobs, or an external bucket |
| **Live leaderboard without paying Supabase** | **Durable Objects, included in the £47** | Would need Supabase Realtime → **£237/yr past 200 connections** |
| **Staff access control** | Zero Trust, free to 50 users | Netlify Identity or build it |
| **Scheduled jobs** | Cron Triggers *(Workers only, not Pages)* | Scheduled Functions |
| **Framework friction** | Astro adapter dropped Pages support at v13 — [use static output](../delivery/nn-build-brief.md#build-it-as-a-worker) | Mature adapter, no equivalent trap |
| **Exit cost** | Low for serving; DNS would have to move back | **Lowest of any option** — Netlify holds only a build config |

### The two that carry real weight

**Netlify's free plan stops serving.** The credit pool is shared across bandwidth and
builds, and when it runs out the site goes dark until someone upgrades. For a [permanent
results
archive](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
that is disqualifying on the free tier — which is why the £85 Personal plan, not £0, is
the honest Netlify figure. Cloudflare's equivalent failure is a bounded overage on a plan
that costs £47.

**Cloudflare can keep Supabase free.** Serving the live leaderboard from Durable Objects
rather than Supabase Realtime avoids the 200-connection ceiling entirely. On Netlify that
route does not exist, so a race-night crowd points at Supabase Pro. **That is a £237/year
divergence hiding behind a £38/year headline** — and it is the strongest financial
argument for Cloudflare.

---

## What each one costs you that the other does not

**Choosing Cloudflare costs a DNS migration.** Every record in the zone moves at once,
including the ones that carry club email, and rollback takes up to 48 hours rather than
minutes. It is the only change in this entire programme that can break something the club
cannot quickly un-break. [What it involves, step by
step](dns-and-domain.md#what-moving-the-apex-to-cloudflare-actually-involves).

**Choosing Netlify costs the DNS position staying exactly as it is.** The zone remains in
a Fasthosts control panel that [one person can
reach](../foundations/current-state.md#accounts-and-access), with a button that would
repoint the apex at Fasthosts' own hosting. Every other part of this programme is being
rebuilt to be code, reviewed and shared; DNS would remain the exception.

**That is the actual trade.** Not £38, and not features: **a one-off migration risk
against a permanent governance weakness.**

---

## The recommendation

> **Cloudflare, if the club is willing to move its nameservers. Netlify if it is not.**
>
> Both are correct answers. What is not correct is choosing Cloudflare and discovering the
> nameserver requirement afterwards.

**The case for Cloudflare** rests on three things, in this order:

1. **It closes the last click-operated single point of failure.** DNS becomes code, in a
   club-owned account both volunteers can reach.
2. **It keeps Supabase on its free tier** by giving the leaderboard somewhere else to live
   — worth £237/yr, six times the headline price difference.
3. It is £38/yr cheaper and R2 charges no egress, which matters once race photographs
   exist.

**The case for Netlify** is one thing, and it is a good one:

1. **The riskiest change in the programme never happens.** No nameserver move, no email
   exposure, no 48-hour rollback window.

**Recommended: Cloudflare** — because the DNS migration is a *bounded, one-off,
rehearsable* risk with a written runbook, while the governance weakness it removes is
permanent and gets worse with time. But this is a committee decision about appetite, not a
technical finding, and a club that says "we are not moving our email DNS" is making a
defensible choice that costs it £38 a year and a £237 exposure.

---

## What neither choice forecloses

Worth stating, because the decision feels heavier than it is.

- **The build is identical.** Astro producing static output plus one function endpoint.
  Moving between them is an adapter change and a redeploy — an afternoon.
- **The data never moves.** Supabase is unaffected either way.
- **Nightingale Nightmare is unaffected.** A subdomain works from Fasthosts DNS on both,
  so [NN can start now](../delivery/nn-first-delivery.md) with this still open.
- **Email is unaffected by the choice itself.** Mailboxes at Fasthosts work under either,
  and cost the same. What differs is *when* the club has to be careful about them — see
  below.

---

## How this interacts with mailboxes

**Neither Cloudflare nor Netlify sells mailboxes.** Cloudflare Email Routing is inbound
forwarding only — the club's current arrangement with a different logo — and Cloudflare
Email Sending is transactional mail from a Worker, not something a person logs into.
**Mailboxes come from a third vendor whichever host is chosen**, and cost the same either
way.

What the hosting choice *does* affect is care and sequencing:

| | Cloudflare | Netlify |
| --- | --- | --- |
| Mailboxes work | Yes — MX unchanged, records copied into the Cloudflare zone | Yes — nothing about the zone changes |
| Extra care needed | **Yes.** Mail records must be copied exactly and kept **DNS-only**, never proxied | None |
| Sequencing | **Matters** — see [email](email.md#sequencing-which-differs-by-provider) | Any order |

**The mailbox provider is settled by the registrar decision, not by this one.** If the
domain stays registered at Fasthosts, Fasthosts mailboxes are the low-friction answer at
~£30/yr with no DNS change. If the registration moves to Cloudflare, Fasthosts would exist
solely to hold email, and an independent provider — **Migadu at ~£15/yr with unlimited
role addresses** — is cheaper and cleaner.
[Email](email.md#so-does-it-still-make-sense-to-use-fasthosts) sets out the comparison.

One thing to confirm either way: **whether the Fasthosts email package survives if the
club later moves the domain registration away.** DNS moving is fine; registration moving
may not be, and [email](email.md#verify-on-the-upgrade-page-before-buying) lists it as a
question for the account holder.
