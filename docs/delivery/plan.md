# The plan

End to end, from today to Squarespace switched off.

[Priorities](priorities.md) explains *why* the work is ordered by dependency rather than
by calendar. This says *what happens*, now that the
[decisions](../decisions/decision-log.md) exist and the numbers are [measured rather than
estimated](../foundations/current-state.md#the-flow-of-money).

**Phases, not dates.** Only two dates in this document are real; everything else is
ordered by what it depends on, because [dates invented to fill a plan become commitments
nobody agreed to](priorities.md).

---

## The two real dates

| | |
| --- | --- |
| **Nightingale Nightmare** | **25 October or 1 November 2026** — [still unconfirmed](../foundations/current-state.md#the-club-and-its-races), and 25 October is clocks-change morning |
| **Squarespace renews** | **21 March 2027**, automatically. Doing nothing costs another £204 |

## The one thing on the critical path

**The member fund.** Around 103 people must each personally re-establish a payment, the
mandates cannot be transferred, and because the processor is **Squarespace Payments** they
cannot outlive the platform either. That is a communications exercise measured in months,
and **it is the only item here that cannot be accelerated by working harder.**

It is also **growing** — 58 payments a month in 2025, 103 in the last thirty days. Every
month of delay adds people who will have to be asked to move.

Everything else has slack.

---

## Phase 1 — Identity and foundations

*Costs almost nothing, blocks almost everything, and gets worse the longer it waits.*

| | Why now |
| --- | --- |
| **Buy a Fasthosts admin mailbox; verify mail works** | The club cannot own an account without an address of its own. Also settles the mail records before the zone is captured |
| **Create Cloudflare, Supabase and GitHub under that address** | Club-owned from day one. Transfers are the step that never happens |
| **Add the second volunteer as a full admin on each** | Two independent owners, not a shared login |
| **Regularise the existing GitHub organisation** and move the timing repository into it | It sits under a personal account today |
| **Turn on two-factor authentication for Squarespace Payments** | It is off, on the account that receives every pound the club takes |
| **Rescue everything off Squarespace's CDN** — 45 documents, 33 newsletters, every image | **Cancelling the subscription deletes them.** Free to do now, impossible to do later. [This is a prerequisite, not a cleanup task](../foundations/requirements.md#continuity) |
| **Settle the Nightingale Nightmare date** | It blocks race planning, and 1 November avoids the clocks change for nothing |
| **Apply for England Athletics verification access** | The lead time belongs to somebody else, and a fallback exists meanwhile |

## Phase 2 — Move the DNS, change nothing

*[The full plan](dns-first.md). Three evenings and a morning, spread over a fortnight.*

Capture the zone → lower TTLs, wait → stage in Cloudflare with **every record DNS-only** →
diff, second person checks → switch nameservers, test email → watch 48 hours → commit the
zone as code.

**Nothing observable changes.** Squarespace keeps serving, Fasthosts keeps carrying mail.
The risk is spent in a quiet week rather than against a deadline, and the March apex
cutover becomes a record edit rather than a migration.

## Phase 3 — Nightingale Nightmare, in parallel

*[Scope](nn-first-delivery.md) and [build brief](nn-build-brief.md). Needs the Cloudflare
account from Phase 1 and nothing else.*

| | |
| --- | --- |
| **Sign-ups live** — one page, name and email, privacy notice | Deploys to `pages.dev` immediately; takes a club hostname whenever DNS is ready |
| **Decide entries: club-built or Full On Sport for 2026** | **By the end of August.** Working back from the race, paid entries want to open in early September — [the governance gates and commercial-use terms bite then, not in March](nn-first-delivery.md#the-finding-commercial-use-bites-in-weeks-not-in-april) |
| **Race, timing and results** | Needs solo-format and age-band work on the timing platform. Its hosting does not move for this |

## Phase 4 — Payments and the member fund

*Starts as early as governance allows. Runs for months. **The critical path.***

| | |
| --- | --- |
| **Satisfy the governance gates** | Data-protection advice, and treasurer-controlled payment arrangements. **Nothing about payment starts before these** |
| **Decide card or Direct Debit — once** | Direct Debit is worth **~£250/yr**, more than every platform decision combined. **Decide it before asking anybody to move**, so 103 people are asked once rather than twice |
| **Move the fund**, using hosted payment pages that need no website at all | Decouples the fund from the rebuild entirely, so March never depends on the build |
| **Reconcile** | The treasurer must be able to account for all four money flows |

**This does not wait for the website**, and it must not.

## Phase 5 — Rebuild the website

*Ordered by [what people actually
read](../foundations/current-state.md#what-people-actually-read), not by what a club
website is assumed to need.*

| | Share of traffic | |
| --- | --- | --- |
| **Results archive, published automatically** | **16.6%**, longest dwell on the site at 6:08 | The flagship. Removes a manual process *and* improves the most-wanted page |
| Home, runner information, about the club | 33.6% + 14.1% + 13.1% | The bulk of the site. Mostly static content in the repository |
| Newsletters, mirrored from Mailchimp | 9.2% | Automate the mirroring; the archive is read for recent issues, not for 2023 |
| Membership pages and forms | 7.8% | |
| Documents and policies | 0.9% | **Hosting and stable URLs, not a product** |
| Kit | **1.1%** | [Re-scope before building](priorities.md#what-the-usage-data-says-about-priority) — the requirements call it the largest build in the site |

Every existing URL must still resolve, including the [legacy paths still taking
traffic](../foundations/current-state.md#legacy-urls-still-receiving-traffic).

## Phase 6 — Cut the apex over

*A record change inside Cloudflare. Seconds to make, seconds to reverse — because Phase 2
already happened.*

Drop the now-pointless `a` mechanism from the SPF record at the same time. Verify every
old URL and redirect. Then leave it running while people use it.

## Phase 7 — Switch Squarespace off

**Before 21 March 2027**, and only when all of these are true:

- [ ] The website is rebuilt, proven, and serving the apex
- [ ] **Every URL still resolves**
- [ ] **The member fund has fully moved** — or the old fund page is being redirected as
  the [escape hatch](priorities.md#the-escape-hatch)
- [ ] **Every document, newsletter and image is off Squarespace's CDN and held by the
  club**
- [ ] The treasurer can reconcile everything on the new arrangement

---

## What this is worth

| | Per year |
| --- | --- |
| Today | **£735** |
| After Phases 1–7 | **£427** |
| With Direct Debit as well | **£177** |

**But the money was never the point.** The larger return is the [manual
chain](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do)
— results typed by hand, WhatsApp requests checked against membership, newsletters
mirrored, entries imported from CSV — and it appears on no invoice. The one measure still
uncaptured is volunteer time, and it is the biggest number in this document.

## What gets worse if it waits

| | |
| --- | --- |
| **The member fund** | Grows every month. More people to ask, same deadline |
| **Content on Squarespace's CDN** | Retrievable now, gone at cancellation |
| **Accounts reachable by one person** | The only item that deteriorates purely with time |
| **The Squarespace renewal** | Automatic. Silence costs £204 |

## Still undecided, and when it must be settled

| | By |
| --- | --- |
| **The Nightingale Nightmare date** | Now — it blocks race planning |
| **NN 2026 entries: club-built or Full On Sport** | End of August |
| **Card or Direct Debit for the fund** | Before anyone is asked to move |
| **Fasthosts' sending limits and price per mailbox** | Before buying the second mailbox |
| **Whether the domain moves to a club-held account** | No deadline. It is a governance exposure, not a technical one |
| **Committee editing** | [Deliberately deferred](priorities.md#what-can-safely-be-decided-later) until it is known what they actually ask to change |
