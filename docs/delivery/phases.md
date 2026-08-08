# The four phases

The shape of the programme, end to end. **Start here**, then use
[the plan](plan.md) for the numbered steps and the
[runbooks](runbooks/) for the procedures.

| | | Ends when |
| --- | --- | --- |
| **[Phase 1](#phase-1--nightingale-nightmare-and-timing-on-the-club-domain)** | Nightingale Nightmare and timing on the club domain, on Supabase | Sign-ups work at `nn.southvillerunningclub.co.uk` and the data lands in the club's own database |
| **[The nameserver move](#between-1-and-2--the-nameserver-move)** | Authoritative DNS from Fasthosts to Cloudflare | Cloudflare answers for the zone, nothing else has changed |
| **[Phase 2](#phase-2--the-new-website-alongside-the-old)** | The new website built alongside the old one, at `new.southvillerunningclub.co.uk` | Every page the old site has, the new one has |
| **[Phase 3](#phase-3--move-the-member-fund)** | Move the recurring payments | All ~103 payers have re-established their payment |
| **[Phase 4](#phase-4--switch-the-apex-and-decommission-squarespace)** | Switch the apex and turn Squarespace off | Squarespace cancelled, **before 21 March 2027** |

**Two dates are real.** Nightingale Nightmare — Halloween weekend 2026, with **sign-ups
opening around late August**. And **Squarespace renews automatically on 21 March 2027**;
silence costs £204. Everything else is ordered by dependency.

---

## Two things about this ordering worth knowing before reading on

**The nameserver move is not in any of the four phases, and it has to happen.** Phase 1 and
Phase 2 both work from CNAMEs at Fasthosts — a subdomain needs nothing else. **Phase 4 does
not**: Cloudflare will not serve a bare domain unless it is authoritative for the whole
zone. So the move is a prerequisite for Phase 4, and it is [the only change in the programme
that cannot be quickly un-broken](runbooks/nameserver-move.md).

That gives it exactly one sensible home: **between Phase 1 and Phase 2**, when nothing
depends on it. Doing it inside Phase 4, against the Squarespace clock, would put the
riskiest change next to the hardest deadline. See [move the DNS first](dns-first.md).

**Phases 2 and 3 overlap on purpose.** Phase 3 is the long pole — around **103 people must
each personally re-establish a payment**, which is a communications exercise measured in
months. It cannot wait for Phase 2 to finish.

More precisely, and this is the highest-value sequencing point in the programme: **the
payment page is built first within Phase 2**, and every *new* subscriber is sent to it from
that day. The old list currently grows by about **45 payments a month**. Building the
payment page early is what turns Phase 3 from a growing problem into a fixed one.
[Decision 004](../decisions/decision-log.md).

---

## Phase 1 — Nightingale Nightmare and timing on the club domain

**The goal: a hello-world page reaching production through the whole pipeline, on the club's
domain, writing to the club's own database.** Everything after this is more of the same
shape.

### What is in it

| | |
| --- | --- |
| **The monorepo exists** | Workspace root, `apps/nn`, `packages/db`. [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) |
| **The pipeline exists** | Local stack on `localhost` with fabricated data; CI brings up the same stack and runs acceptance tests. [ADR-003](../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **Cloudflare Pages project**, git-connected, `main` deploys production | [Runbook](runbooks/nn-to-club-domain.md) |
| **`nn.southvillerunningclub.co.uk`** | One additive CNAME at Fasthosts |
| **`timing.southvillerunningclub.co.uk`** | One additive CNAME. **See the caveat below** |
| **Supabase** | `intake.nn_interest`, RLS, migrations applied from CI. [ADR-002](../architecture/decisions/adr-002-schema-layout.md) |
| **The sign-up page and form** | Name, email, consent, timestamp. Nothing else. [Build brief](nn-build-brief.md) |

### Running alongside, and it should start now

**Rescue everything Squarespace will delete when it is cancelled** — around 45 documents, 33
newsletters, every image, plus the seven on Google Drive. Free to do today, **impossible
after cancellation**, and it depends on nothing. [Plan](plan.md) steps 12–15.

### ⚠️ The one caveat — `timing.` is a hostname, not a migration

`timing.southvillerunningclub.co.uk` is **one additive CNAME**, and that part is easy.
**Moving the timing application itself onto Cloudflare is a different proposition** and
should not be bundled into Phase 1:

- The [risk constraint](../foundations/requirements.md#risk) is explicit — the timing
  platform is **proven in production and race-day critical**, a race happens once a year, and
  it cannot be re-run.
- It is **Next.js**, so running it on Cloudflare means OpenNext. Pages is the wrong product
  for it, and that is a real port rather than a redeploy.
- [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) puts it in the monorepo **with
  the Cloudflare port, after the 2026 race**.
- [Plan](plan.md) step 40 already says the app **stays on Vercel — only its address
  changes** — and that the hostname work happens *"in August, or after the race in November.
  Not in the weeks between."*

**So Phase 1 gives `timing.` a club hostname pointing at wherever the app runs today.** The
port to Cloudflare is deliberately later. **This is an open decision** — see
[still to settle](#still-to-settle).

### Done when

- [ ] `nn.southvillerunningclub.co.uk` serves over HTTPS with a valid certificate
- [ ] A sign-up writes exactly one row to `intake.nn_interest`
- [ ] The form works **with JavaScript disabled**; malformed input is rejected server-side
- [ ] An anonymous client **cannot** read anything in `club`
- [ ] CI is green: lint, types, migrations from zero, unit, Worker, Playwright + axe at zero
      violations
- [ ] A pull request produces a preview URL
- [ ] `timing.southvillerunningclub.co.uk` resolves and serves
- [ ] **Club email still works** — sent and received since the last DNS change
- [ ] **Both volunteers can reach** the repository, the Cloudflare project and Supabase
- [ ] Everything done by hand is written down

---

## Between 1 and 2 — the nameserver move

**Not one of the four phases, because nothing in the four phases needs it until Phase 4.**
It sits here because this is when it is cheapest.

| | |
| --- | --- |
| **What changes** | One setting at Fasthosts: the nameservers |
| **What does not** | Registration, mail routing, where the website is served, every record's value |
| **Risk** | **Real — it carries club email.** The only change reversible in *up to 48 hours* rather than minutes |
| **Effort** | Three evenings and a morning, across ~2 weeks because of two waiting periods |
| **Procedure** | [The nameserver-move runbook](runbooks/nameserver-move.md) |

**Not in the same week as the Nightingale Nightmare launch**, not in race week, not on a
Friday, not near the Squarespace renewal.

### What it unblocks

Workers custom domains, the current Astro Cloudflare adapter, Cron Triggers — and it turns
**Phase 4's apex cutover from a DNS migration into a record edit** that takes seconds and
reverses in seconds.

---

## Phase 2 — the new website alongside the old

The old site keeps running throughout. The new one grows beside it at
`new.southvillerunningclub.co.uk`, **with paths matching the old site**, so every address is
proven long before anything switches. [Decision 004](../decisions/decision-log.md).

### Order within the phase, and it is not arbitrary

1. **The payment page first**, before anything else on the site. Take one real payment end to
   end, confirm the treasurer can see it, then **send every new subscriber to it from that
   day**. *This is what stops the old list growing, and it is worth more than anything else
   in this phase.*
2. **The results archive** — 16.6% of traffic, the longest-read pages, and typed by hand
   today. It publishes itself from the timing data, which is why
   [one database](../architecture/decisions/adr-002-schema-layout.md) matters.
3. **The main pages** — home, runner information, about. 61% of traffic between them.
4. **The newsletter mirror**, automated from Mailchimp.
5. **Documents and policies** onto club-controlled storage with stable URLs.
6. **Membership pages and forms.**
7. **Re-scope the kit section before building it** — 1.1% of traffic against the largest
   build in the requirements.

### Constraints

| | |
| --- | --- |
| **`noindex` across the whole subdomain** until cutover | Two copies of the same content otherwise split the club's search results; 314 visits a month arrive from Google |
| **No payment work before the governance gates** | Data-protection advice and treasurer-controlled payment arrangements. **Firm gates, not formalities** |
| **Paths mirror the old site** | So Phase 4 can be checked for real rather than promised |

### Done when

Every old address has a match on the new site — including the [legacy paths still taking
traffic](../foundations/current-state.md#legacy-urls-still-receiving-traffic) — accessibility
and phone performance are checked, and the payment page has been live long enough that new
subscribers are no longer joining the old list.

---

## Phase 3 — move the member fund

⚠️ **The one part of the programme that asks something of members.**

Around **103 people** pay £2.50 a month. Those mandates live inside Squarespace Payments and
**cannot be transferred** — every person has to set theirs up again.

**This is a communications exercise measured in months, not a technical task.** It is the
longest part of the programme and the only part that cannot be sped up by working harder.

### Gates, in order

1. **Data-protection advice.** A gate, not a formality.
2. **Treasurer-controlled payment arrangements** in place.
3. **Decide card or Direct Debit — before anybody is asked to move.** Worth about **£250 a
   year**, and deciding late means asking 103 people twice.

### Then

Tell the existing payers with a deadline and repeat it; track who has moved and who has not;
and accept that **two payment sources are being reconciled** while it runs — time-box that
rather than letting it drift.

**Starts during Phase 2, not after it.** It only needs the payment page, not the finished
website.

---

## Phase 4 — switch the apex and decommission Squarespace

**Requires the [nameserver move](#between-1-and-2--the-nameserver-move) to have happened.**
Cloudflare cannot serve the bare domain otherwise.

### The switch

**One coordinated moment**, because Squarespace 301-redirects every secondary domain to its
primary — so the old site cannot be reachable at `old.` while it still serves `www`.

1. **Decide where the old site lives afterwards** — `old.southvillerunningclub.co.uk`, which
   means changing Squarespace's primary domain, or simply its built-in
   `*.squarespace.com` address, which needs no DNS at all and is adequate for a treasurer and
   a few stragglers.
2. **In one sitting:** point the apex and `www` at the new site, and switch Squarespace's
   primary domain if using `old.`
3. **Tidy the SPF record** by dropping the now-pointless `a` mechanism.
4. **Remove `noindex`, and redirect `new.` to the apex** so bookmarks are not stranded.
5. **Walk every old address** and confirm nothing 404s.
6. **Leave it running** while members actually use it.

*Because the nameservers moved back in the gap after Phase 1, step 2 is a record change
inside Cloudflare — seconds to make, seconds to reverse.*

### Decommission

**Confirm all five before cancelling:** the site is rebuilt and serving the apex; every URL
resolves; the member fund has moved; every document, newsletter and image is held by the
club; and the treasurer can reconcile.

**Then cancel Squarespace — before 21 March 2027.** Check afterwards that email, the website
and the results archive all still work.

---

## Still to settle

| | By |
| --- | --- |
| **Does the timing app port to Cloudflare, and when?** Phase 1 gives it a hostname; the port is a separate, race-critical decision | Before any work touches the timing repository |
| **Where exactly the nameserver move lands** in the calendar | It only needs a quiet fortnight, but it needs one chosen |
| **NN 2026 entries — own site or Full On Sport** | Now. Paid entries want to open in early September |
| **Card or Direct Debit** | Before anyone is asked to move *(Phase 3)* |
| **Where the old site lives after cutover** | Before Phase 4 |
| **The backup runbook**, with a tested restore | Before the archive is load-bearing |

## What it costs when this is done

| | Per year |
| --- | --- |
| Today | **£735** |
| After Phase 4 | **£427** |
| With Direct Debit as well | **£177** |

**The money was never the point.** The larger return is the [manual
work](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do)
this removes — results that publish themselves, a newsletter archive that keeps itself up to
date, and membership requests that do not need checking by hand.
