# Move the DNS first

**The proposal: move the nameservers to Cloudflare now, with every record still pointing
at Squarespace, so nothing changes for anybody. Then build on Cloudflare from inside the
zone.**

**Yes, this works, and it is a better ordering than the one the rest of this documentation
assumed.** This document sets out why, what makes it safe, and the sequence.

Mechanics of each DNS move are in [DNS and domain](../solutions/dns-and-domain.md); this
is about the order they happen in.

---

## Why this is better than moving DNS at the end

The plan the other documents assumed was: build the site, prove it, then move DNS and cut
the apex over together, before the [21 March 2027
deadline](priorities.md#2-off-squarespace-before-it-renews--21-march-2027).

That ordering has the club performing **the single riskiest change in the programme** in
the same season as a deadline, with a finished website waiting on it. Doing it first
inverts every one of those properties.

**It decouples the risk from every deadline.** The nameserver move is the only change here
that takes up to 48 hours to reverse. Doing it in a quiet week in August, when *nothing*
depends on it, is categorically safer than doing it in March when the Squarespace clock is
running.

**Nothing observable changes, so a mistake is cheap.** Every record keeps pointing where
it points today. Squarespace still serves the site. Fasthosts still carries the mail. If a
record is wrong, the club finds out with no deadline pressure and the old zone is still
sitting at Fasthosts.

**It turns the March apex cutover into a non-event.** Once Cloudflare is authoritative,
repointing the apex is a record change *inside* Cloudflare — effective in seconds,
reversible in seconds. The scariest-sounding item on the March list stops being a DNS
migration and becomes a five-minute edit.

**It unblocks the better toolchain.** See below.

---

## The rule that makes it safe

> **Every record is DNS-only on day one. Nothing is proxied. Not one thing.**

With every record DNS-only, **Cloudflare is doing nothing but answering DNS queries** —
the same answers Fasthosts gives today. No traffic passes through Cloudflare. It is a
like-for-like swap of one authoritative nameserver for another.

This matters most for two groups:

**The mail records** — `mail`, `mailserver`, `smtp`, `webmail`, and the four DKIM CNAMEs.
Proxying any of these breaks club email, and the symptom is silent. This is already the
[first hazard](../solutions/dns-and-domain.md#what-specifically-can-go-wrong) in the DNS
document.

**The Squarespace records** — the four apex `A` records, the `www` CNAME, and the
`verify.squarespace.com` CNAME.

**Squarespace supports Cloudflare as a DNS provider and publishes a guide to it.** What
its documentation warns about is the **proxy**, not the DNS hosting — *"the proxy status
can interfere with the connection"* — because a proxied record puts Cloudflare in the
traffic path, terminating TLS in front of a service that manages its own certificates.

The distinction is the whole basis of this plan:

| | What happens | Squarespace's position |
| --- | --- | --- |
| **DNS-only** *(grey)* | Cloudflare answers the query with Squarespace's IP. The visitor connects **directly to Squarespace** | **Supported** |
| **Proxied** *(orange)* | Traffic routes *through* Cloudflare to Squarespace | **Warned against** |

**With every record DNS-only, Squarespace cannot tell anything has changed.** It sees an
ordinary visitor on an ordinary connection and presents its own certificate exactly as it
does today.

The orange cloud is a decision for later, per record, when the club is serving its own
traffic. **Not now, and not on anything Squarespace touches.**

### Two cautions that come with this

**Squarespace will not support the club if something breaks.** Its guide states that
Cloudflare *"falls outside the scope of Squarespace support"*. While Squarespace is still
serving the live site that is a real, if modest, cost — an odd fault leaves two vendors
pointing at each other. The mitigation is the rollback that already exists: nameservers
back to Fasthosts.

**Do not add CAA records.** The zone has [none
today](../foundations/current-state.md#dns-and-email), which is why nothing blocks
certificate issuance. Adding one that restricts which authorities may issue could break
**Squarespace's SSL renewal** — quietly, and weeks later. Cloudflare does not add them
automatically. Leave the absence alone until the club is serving its own traffic and
understands which authorities it needs to permit.

---

## What this unblocks

A constraint documented in the [build
brief](nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything)
exists **only because the zone is at Fasthosts**:

| | Zone at Fasthosts | Zone at Cloudflare |
| --- | --- | --- |
| Cloudflare Pages custom domain | ✅ via CNAME | ✅ |
| **Cloudflare Workers custom domain** | ❌ **requires an active zone** | ✅ |
| `@astrojs/cloudflare` adapter *(v13+ dropped Pages)* | ❌ unusable — static output only | ✅ **usable** |
| Server-rendered pages on the club domain | ❌ | ✅ |

**Moving the zone first removes the pincer.** The club stops being boxed into static-only
output on a superseded deployment product, and the "migrate from Pages to Workers later"
step disappears from the plan entirely.

This does not mean Nightingale Nightmare should change — **static output plus one function
is still the right shape for a page and a form**, and it remains portable. What it means
is that the *website rebuild* is no longer constrained, and nothing has to be built twice.

---

## The sequence

Nothing here is on the critical path for anything else, which is the point.

### Before starting — and the order matters more than it looks

**The club needs an address before it can own anything.** Every account created below is
created *by* an email address, and an account created under a volunteer's personal address
is a club asset held personally — which is [the problem this programme exists to
fix](../foundations/problem-statement.md#4-everything-is-a-single-point-of-failure),
rebuilt in new technology. So the mailbox comes first, and not only for the DNS reasons.

| | | Why it is in this position |
| --- | --- | --- |
| **1** | **Buy a Fasthosts admin mailbox and verify mail works** | **Two reasons.** It creates the club identity everything else is registered under; and Fasthosts configures its own mail records automatically while it still controls the zone, so the zone captured at step 4 is complete and verified. **Doing this later means hand-adding mail records in a panel that no longer controls the zone** |
| **2** | **Create Cloudflare, Supabase and GitHub under that address** | Club-owned from the first day rather than transferred later — transfers are the step that never happens |
| **3** | **Add the second volunteer as a full admin on each, in their own right** | Not sharing a login. Two independent owners, so neither the account nor the mailbox is a single point of failure |

**On the mailbox itself:** it should be a **role address**, not a person's — something
that outlives whoever holds the role. Its own recovery address must not be a personal
Gmail, or the dependency is simply moved one step down.

**A GitHub organisation already exists** under a club Google account,
[`srcdmin@gmail.com`](../foundations/current-state.md#accounts-and-access) — the typo is
in the address itself. Step 2 is a chance to regularise that rather than add a fourth
identity.

### Also before starting

| | |
| --- | --- |
| **The domain is registered at Fasthosts under the Web Manager's personal account** | Confirmed by the Web Manager, August 2026. It resolves the "who holds the registration" question and replaces it with a governance one: **a club asset is held by an individual.** That does not block the DNS move — but it should be on the list to fix, by moving the Fasthosts account to a club identity or transferring the registration later |
| **Confirm Fasthosts' email sending limits and its price beyond two mailboxes** | Neither is published, and both could reopen [decision 003](../decisions/decision-log.md#003--buy-mailboxes-from-fasthosts) |

### The move

| | | Elapsed |
| --- | --- | --- |
| **4** | **Capture the zone.** Export from Fasthosts or transcribe all 18 records. **Commit it to this repository** — it is the rollback reference and the diff baseline | 1 evening |
| **5** | **Lower every TTL at Fasthosts to 300 seconds.** Then wait | **48 hours, passive** |
| **6** | **Create the zone in Cloudflare, let it scan, then add every missing record by hand.** Set **everything** to DNS-only. The zone is staged but not authoritative — nothing is live yet | 1 evening |
| **7** | **Diff record by record against the committed export.** Query the Cloudflare nameservers directly rather than eyeballing the dashboard. **Second volunteer checks it** | Same evening |
| **8** | **Change the nameservers at the registrar.** Quiet weekday morning. **Send and receive a test message on a club address immediately.** Confirm the website still serves, from mobile data as well as home broadband | 15 minutes |
| **9** | **Watch.** Send and receive on club addresses daily. Read DMARC reports | **48 hours, passive** |
| **10** | **Raise TTLs. Commit the zone as code** — Terraform or OpenTofu, so the next change is a pull request. **Leave the Fasthosts zone intact for a month** | 1 evening |

**Three evenings of work and one morning, spread across about two weeks** because of the
two waiting periods.

### Afterwards

| | |
| --- | --- |
| `nn.southvillerunningclub.co.uk` | A record added *inside* Cloudflare — no longer a CNAME at Fasthosts |
| The website rebuild | Can use Workers and server rendering |
| **The apex cutover, before March** | **A record change inside Cloudflare.** Seconds to make, seconds to reverse |

---

## What must not happen

- **Nothing is proxied.** Not the apex, not `www`, and above all not the mail records.
- **The apex is not repointed in the same change as the nameserver move.** Two changes,
  two observation windows. The apex moves months later, when the new site is proven.
- **Not in the same week as the Nightingale Nightmare launch.** If something breaks, the
  club should be debugging one thing.
- **Not in race week**, not on a Friday, and not near the Squarespace renewal.
- **The Fasthosts zone is not deleted** for at least a month.

---

## Nightingale Nightmare runs in parallel, not behind

**NN must not wait for this**, and it does not have to.

Every Cloudflare Pages project gets a free `<project>.pages.dev` hostname immediately —
real HTTPS, real deploys, previews per pull request. **The NN build needs no DNS at all**
until the day it wants a club hostname.

So the two tracks run side by side:

| | Nightingale Nightmare | Email, accounts and DNS |
| --- | --- | --- |
| Week 1 | Repo and Astro scaffold — needs nothing | **Mailbox bought and verified; Cloudflare, Supabase and GitHub created under it; second admin added** |
| Week 2 | Deploying to `pages.dev`, page, form, privacy notice | Capture zone, lower TTLs, stage and diff |
| Week 3 | Ready for a hostname | Switch nameservers, watch |

**Nightingale Nightmare cannot deploy until the Cloudflare account exists**, which is the
one genuine coupling — but that is week 1, and the repository and content can start before
it.

**Whichever finishes first, the other is unaffected.** If DNS has moved, `nn.` is a record
inside Cloudflare. If it has not, `nn.` is [one additive CNAME at
Fasthosts](../solutions/dns-and-domain.md#move-1--add-a-record-no-risk), which is what the
plan assumed anyway.

**Do not schedule both in the same week.** The only real coupling is human attention.

---

## Rollback, at every stage

| Stage | If it goes wrong | Cost |
| --- | --- | --- |
| Staging the zone (steps 6–7) | Delete the Cloudflare zone | Nothing is live. **Zero** |
| Immediately after the switch (step 8) | Fix the record **at Cloudflare** — it is authoritative now, so a correction takes effect within the 300s TTL | **Minutes** |
| Something fundamental | Point the nameservers back at Fasthosts, whose zone is untouched | **Up to 48 hours** |

**Repair forward, not back.** Once Cloudflare is authoritative, correcting a record there
is far faster than reverting the nameservers. Reverting is the last resort, which is
exactly why steps 4–7 carry the weight.

---

## Against the two deadlines

| | |
| --- | --- |
| **NN sign-ups — two weeks** | **Unaffected.** Runs in parallel on `pages.dev` |
| **Off Squarespace — 21 March 2027** | **Materially de-risked.** The DNS migration is done and settled months early; what remains in March is a record edit and the [member fund migration](priorities.md#the-chain-that-decides-the-date), which was always the real long pole |

**The club would be spending its risk budget in August, when it is cheap, instead of
March, when it is not.**
