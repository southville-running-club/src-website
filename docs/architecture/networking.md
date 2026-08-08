# Networking architecture

Hostnames, zones, TLS and routing — which of them exist, which environment each belongs to,
and what may not be touched.

**The club's networking is unusually constrained for a website**, because the same zone
carries club email. [DNS and domain](../solutions/dns-and-domain.md) covers the migration
risk and [move the DNS first](../delivery/dns-first.md) covers the runbook; this covers the
**shape** — what gets a hostname, and why.

---

## Two eras, and almost everything depends on which one you are in

The club's zone is authoritative at **Fasthosts** today and moves to **Cloudflare** before
April. That single fact decides what is technically possible.

| | Zone at Fasthosts *(today)* | Zone at Cloudflare *(after the move)* |
| --- | --- | --- |
| **Subdomain served by Cloudflare** | ✅ Pages only, via CNAME | ✅ Pages or Workers |
| **Apex served by Cloudflare** | ❌ Not possible | ✅ |
| **Workers custom domains** | ❌ Requires an active zone | ✅ |
| **DNS as code** | ❌ A control panel | ✅ Terraform/OpenTofu |
| **Automatic certificates** | ✅ For Pages custom domains | ✅ Everywhere |
| **Cron Triggers** | ❌ Not on Pages | ✅ Workers feature |

**This is why Nightingale Nightmare v1 must be a Pages project**, and why the
[build brief](../delivery/nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything)
specifies static Astro with no adapter. It is also
[the strongest argument for moving the DNS early](../delivery/dns-first.md) — the
constraint disappears the moment the nameservers change, and everything after it gets
easier.

---

## Hostname plan

### What exists today

The zone holds **18 records**, catalogued in [plan](../delivery/plan.md) step 23 as the
rollback reference. Four groups matter here:

| | Purpose | May Cloudflare proxy it? |
| --- | --- | --- |
| Apex (4 records) | The website, at Squarespace | ❌ **No** — Squarespace serves it |
| `www` | The website | ❌ **No** |
| `mail`, `mailserver`, `smtp`, `webmail` | **Club email at Fasthosts** | ❌ **Never** |
| `mcp` | Existing service | ❌ No |
| MX, SPF, DKIM, DMARC | **Mail authentication** | n/a — not proxiable record types |
| Squarespace verification | Domain ownership proof | ❌ No |

**Eleven records must have the orange cloud turned off**, and Cloudflare turns it on by
default on import. That is [plan step 27](../delivery/plan.md), and it is the single
highest-consequence step in the DNS move.

### What gets added

| Hostname | Serves | When | Notes |
| --- | --- | --- | --- |
| `nn` | Nightingale Nightmare | **Now** — one additive CNAME | [Cannot break anything](../foundations/glossary.md#domains-and-dns): nothing resolves that name today |
| `timing` | The timing platform | August, or after November | Points at Vercel initially, not Cloudflare |
| `new` | The website, built alongside the old one | After the DNS move | `noindex` until cutover |
| `send` *(or similar)* | Transactional mail from Resend | With [C8](../foundations/requirements.md#c8--send-email-as-the-club) | **A dedicated sending subdomain**, so transactional reputation is separate from the club's own mail |
| `staging` *(proposed)* | Pre-production website | Optional | See [environments](#environments-and-their-hostnames) |
| apex + `www` | The new website | At cutover | The one coordinated moment |

### Naming conventions worth fixing now

Cheap to set, expensive to change once published — and
[C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
requires URLs that resolve in 2036.

| | Convention |
| --- | --- |
| **One label, no nesting** | `nn.`, not `nn.races.` — every level adds a certificate and a record to get wrong |
| **A race gets a subdomain only if it needs its own front door** | Otherwise it is a path on the main site. `nn.` exists because the race had no presence at all; Pass the Buck may not need one |
| **Environments are subdomains of the club domain only if they must be** | See [below](#environments-and-their-hostnames) — most should not be |
| **Nothing user-facing on `*.pages.dev` or `*.workers.dev`** | Fine for previews, wrong for anything announced. An address that is announced is an address that must keep working |

---

## Proxied or DNS-only

Cloudflare's orange cloud decides whether traffic passes through Cloudflare's network or
whether Cloudflare simply answers with the destination address.

| Record | Setting | Why |
| --- | --- | --- |
| Anything Cloudflare serves — Pages, Workers | **Proxied** | Required. This is how the certificate and the CDN work |
| **Every mail hostname** | **DNS-only** | Proxying a mail host breaks mail. Non-negotiable |
| Apex and `www`, while Squarespace serves them | **DNS-only** | [Squarespace supports Cloudflare as a DNS provider but warns on the proxy](../solutions/platform-options.md#validation-register) |
| Third-party verification records | **DNS-only** | Proxying changes what the verifier sees |
| `timing`, while on Vercel | **DNS-only** | Vercel issues its own certificate |

**The check that catches this:** after the nameserver move, resolve the apex and confirm it
returns **Squarespace's** addresses, not a Cloudflare one. A Cloudflare address means
something is still proxied. That is [plan step 34](../delivery/plan.md).

---

## Certificates

Mostly automatic, with two traps.

| | |
| --- | --- |
| **Pages and Workers custom domains** | Cloudflare issues and renews automatically. Nothing to do |
| **Order matters** | **Associate the custom domain in the Cloudflare dashboard *first*, then add the DNS record.** The other order produces a **522**. [Plan step 37](../delivery/plan.md) |
| **Vercel-served `timing.`** | Vercel issues its own certificate and needs the record DNS-only |
| **Renewal** | Automatic while the record stays as configured. A record edited by hand can silently break renewal months later |

---

## Routing on Cloudflare

Three ways a request reaches a Worker, and they are not interchangeable.

| | What it is | Needs a zone? |
| --- | --- | --- |
| **`workers.dev` subdomain** | `<worker>.<account>.workers.dev`, automatic | ❌ No |
| **Custom Domain** | The Worker **is** the origin for a hostname. Cloudflare creates the DNS record and certificate itself | ✅ Yes |
| **Route** | A pattern within a zone where a Worker sits **in front of** an existing origin | ✅ Yes |

For the club, **Custom Domains are the right primitive** once the zone moves — the Worker
is the origin, there is nothing behind it. Routes matter only if something ever needs to
sit in front of Squarespace during a transition.

### Preview URLs, and their one limitation

Workers generate two kinds of preview address:

- **Versioned** — a unique URL per version, automatically
- **Aliased** — a stable human-readable alias assigned to a version

Both take the form `<version-or-alias>-<worker>.<subdomain>.workers.dev`.

> **Preview URLs cannot currently run on a subdomain other than `workers.dev`.**

That is a real constraint on any plan to give previews club-branded hostnames, and it is
mostly a *good* constraint: preview environments should not be on the club domain anyway.
See [local development](local-development.md#validating-without-the-club-domain).

---

## Environments and their hostnames

The instinct is one subdomain per environment on the club domain. **Resist most of it.**

| Environment | Proposed hostname | Reasoning |
| --- | --- | --- |
| **Local** | `localhost` | No DNS, no certificate, no cost. Where nearly all validation happens |
| **Preview** *(per pull request)* | `*.workers.dev` / `*.pages.dev` | Automatic, free, isolated, and **cannot be confused with the real site** |
| **Shared demo** *(showing someone something)* | A Cloudflare **Quick Tunnel** on `trycloudflare.com` | Free, no account, no DNS. Temporary by design |
| **Staging** | **Open question** — `staging.southvillerunningclub.co.uk`, a separate cheap domain, or none | See below |
| **Production** | Apex, `www`, `nn`, `timing` | The real thing |

**Why keep environments off the club domain where possible.** Every extra hostname on the
club zone is another record that can be mis-proxied during the DNS move, another
certificate, and another address that might get indexed or shared. The club's zone carries
**email**, and the [risk constraint](../foundations/requirements.md#risk) says treat things
that can break mail differently from things that cannot.

**The one thing that genuinely needs a real domain:** email authentication. SPF, DKIM and
DMARC cannot be meaningfully tested on `localhost` or `workers.dev` — see
[local development](local-development.md#what-cannot-be-tested-without-a-real-domain).

---

## How this interacts with email

The most consequential coupling in the whole platform, and the reason the DNS move is
treated with more care than a website change deserves.

| | |
| --- | --- |
| **The MX records do not change** | [Decision 003](../decisions/decision-log.md) chose Fasthosts mailboxes partly *because* it needs no MX change. Removing a mail-affecting change from a programme that already has one was worth more than £15/yr |
| **Sequencing** | Mailboxes are bought **before** the nameserver move, so Fasthosts writes its own mail records while it still controls the zone, and the club copies one settled, verified zone into Cloudflare |
| **Decline Cloudflare Email Routing** | If offered during setup it would **replace the MX records**. [Plan step 29](../delivery/plan.md) |
| **Transactional mail is separate** | Resend, from a dedicated sending subdomain, so a bounced entry confirmation cannot damage the reputation of the club's own mail |
| **SPF has to be tidied later** | [Plan step 64](../delivery/plan.md) — the `a` mechanism becomes pointless once the apex no longer points at a mail-sending host |
| **Test mail first, always** | After any nameserver or MX-adjacent change, send **and receive** before checking anything else. [Plan steps 33 and 92](../delivery/plan.md) |

---

## Failure modes, and how fast each reverses

The property that makes the DNS plan defensible is that almost everything is fast to undo.
The one exception is worth knowing precisely.

| Change | Reverses in | Notes |
| --- | --- | --- |
| **Adding a subdomain record** | Seconds | [Additive](../foundations/glossary.md#domains-and-dns) — nothing resolved that name before, so deleting it restores the previous state exactly |
| **Repointing a record** at Cloudflare | Minutes, once Cloudflare is authoritative | This is a *cutover*, and it is why the DNS move is worth doing early |
| **Turning a proxy off** | Minutes | Fix at Cloudflare, not by reverting anything |
| **Changing the nameservers** | **Up to 48 hours** | **The only genuinely slow one.** Both nameserver sets are live during the window and must agree |

> **If anything breaks after the nameserver move, fix it at Cloudflare** — that takes five
> minutes. Reverting the delegation is the last resort, not the first response.

---

## Still to answer

| | |
| --- | --- |
| **Is there a staging hostname at all**, and on which domain | Interacts with [local development](local-development.md#validating-without-the-club-domain) and with whether the club buys a second throwaway domain |
| **Does Pass the Buck get a subdomain**, or stay a path on the main site | `nn.` exists because the race had no presence; PtB has one already |
| **What the transactional sending subdomain is called** | `send.`, `mail.` is taken, `notifications.` — cosmetic but permanent |
| **Whether the registrar moves to Cloudflare** | [Governance, not technical](../solutions/dns-and-domain.md). Worth doing for consolidation rather than the ~£7 |
| **DNS as code — Terraform or OpenTofu** | [Plan step 36](../delivery/plan.md) says the records land in the repository. Which tool, and which repository, is undecided |
