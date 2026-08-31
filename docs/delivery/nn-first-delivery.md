# Nightingale Nightmare first

> ⚠️ **Historical — written before the build, and its open questions are answered now.**
> The race date, the entry price and the England Athletics pricing question it lists as
> blockers are all settled (see [the phases](phases.md) and the decision log); the "Full
> On Sport vs the club's own site" question it argues from Response B was decided the
> other way — [the plan](plan.md) step 22 records "the club's own site, with Stripe." Kept
> for why NN was built first, not as a live description of what remains open.

The first thing the club builds, why it is this and not the website, and what it forces to
be decided.

[Priorities](priorities.md) names two fixed dates and puts an NN sign-up page in two
weeks. This document takes that seriously and works out what it actually means — including
one finding that changes the sequencing in [priorities](priorities.md).

Read with [platform options](../solutions/platform-options.md) for the stack and [DNS and
domain](../solutions/dns-and-domain.md) for the hostname.

---

## Why Nightingale Nightmare goes first

Not because it is the biggest thing. Because it is the only piece of work that is
**useful, small, and forcing** all at once.

**Useful.** [Nightingale Nightmare has no web presence at
all](../foundations/problem-statement.md#6-two-races-one-of-them-invisible). Pass the Buck
at least has a page. NN has nothing — no date, no entry route, no way for a runner who
heard about it to find it. Anything is an improvement over nothing.

**Small.** A page, a form, somewhere to keep a name and an email address, a hostname, a
deploy. That is days of work, not two weeks.

**Forcing.** It is the first thing that has to exist on new tooling, under the club's own
domain, built the club's way — as code, reviewed, deployed by pipeline. It proves the
whole model in miniature at a scale where getting it wrong costs an evening. Every pattern
established here — repository layout, deployment, hostname, how a form submission is
stored, how personal data is handled — is reused by the website rebuild that follows.

**And it is not on the critical path to April**, which means it can be got wrong and
redone without threatening anything. That is exactly the right property for the first
thing built.

---

## The date, which nobody has settled

> ## ✅ Settled — 12 August 2026: **Sunday 1 November 2026, start 11:00**
>
> The club's published campaign artwork carries it, and the maintainer confirmed it. **The
> recommendation below was taken**, for the reason below. The argument is kept as it was
> made rather than rewritten to match the answer — it is the reasoning that is worth having
> later, not a tidy file.

**The 2026 date is unconfirmed.** Club notes disagree between **25 October** and **1
November**. Both are Sundays. Everything below moves with it, and it is the cheapest thing
on this list to resolve.

One fact that should settle at least part of the argument:

> **25 October 2026 is the last Sunday in October — the morning the clocks go back.**

A mass-start 10 km whose start time falls on the hour the clocks change is not a
scheduling detail. The timing platform already treats this as a known hazard and pins
`Europe/London` through a single tested code path, and the race would be the first live
test of that path under real conditions. **1 November avoids the problem entirely and
costs nothing.**

This is a race-organising decision, not a technical one, and it belongs to the club. But
the technical input is unambiguous: *if the date is not yet committed, take 1 November.*

### What the date does to everything else

Taking today as **6 August 2026**, the race is **11 or 12 weeks away**.

| | Working back from a 1 November race |
| --- | --- |
| Race day | 1 Nov |
| Entries close | ~25 Oct |
| **Entries open** — realistically 7–8 weeks of selling | **~early September** |
| Sign-up / interest page live | **~20 August** — the two-week date |
| Today | 6 August |

---

## The finding: commercial use bites in weeks, not in April

[Priorities](priorities.md#what-is-genuinely-on-the-critical-path) concludes that
Nightingale Nightmare is not on the critical path, and against the *April* deadline that
is correct.

But the schedule above says paid entries want to be open in **about four weeks**. And
[platform options](../solutions/platform-options.md#the-two-questions-that-eliminate)
establishes that **Vercel's Hobby tier prohibits commercial use, naming payment processing
explicitly.**

Put those together:

> **The hosting decision has a September forcing function, not an April one.** The moment
> NN takes an entry fee, the club needs a host whose terms permit it — and the platform
> the club already uses is not one.

[Priorities](priorities.md#what-the-two-weeks-actually-needs) anticipated the shape of
this: *"That exemption ends the moment entries are paid for — which is a useful forcing
function, because it puts the hosting decision at the same point as the payments
decision."* What it did not have was the date. The date is early September, and that is
four weeks away, not eight months.

### Two ways to respond, and both are legitimate

**Response A — build NN on the target stack now.** Choose the host that permits payments,
build NN v1 on it, and add payments when the [governance
gates](../foundations/requirements.md#legal-and-governance) are satisfied. No migration,
no second decision. This is what [platform
options](../solutions/platform-options.md#the-recommendation) recommends, and NN is small
enough that being wrong is cheap.

**Response B — take NN 2026 entries through Full On Sport, as now.** The club already has
this route, the fee is [paid by entrants rather than the
club](../foundations/current-state.md#race-entries), and it removes the payment dependency
from the October date completely. The club's own site becomes the shop window and the
information source; the transaction stays where it is for one more year.

**Response B is the better risk position for the 2026 race, and it does not conflict with
Response A.** Build NN on the target stack because that is right anyway, and decide
separately — with the treasurer and against the governance gates — whether the club's own
entry flow is ready to carry real money by September. If it is not, Full On Sport carries
2026 and the club's own flow launches for Pass the Buck or NN 2027.

**What must not happen is drifting into September with entries unsold because a payment
integration is nearly ready.** The fallback exists; the decision to use it should be taken
deliberately and early, not discovered.

---

## Version 1 — the two weeks

### What it is

A page at `nn.southvillerunningclub.co.uk` that tells a runner what the race is and
captures their interest.

| | |
| --- | --- |
| **The page** | What the race is, where, when, distance, who it is for, what it costs, and "register your interest" |
| **The form** | **Name and email address only** |
| **The storage** | One table. Name, email, consent, timestamp |
| **The confirmation** | An on-page acknowledgement. Email confirmation is not required for v1 |
| **The hostname** | **Attached as a custom domain on the Worker** — Cloudflare creates the record. Nothing at Fasthosts |

### What it must not do

Taken directly from [priorities](priorities.md#what-this-phase-must-not-do), and worth
repeating because time pressure erodes exactly these:

- **Must not collect more than it needs.** Name and email carry a light data-protection
  burden. Date of birth, emergency contacts, England Athletics numbers and medical
  information do not, and none of them are needed to tell somebody when a race is.
- **Must not take money.** That trips the [governance
  gates](../foundations/requirements.md#legal-and-governance) and the commercial-use terms
  in the same step, and neither is ready in two weeks.
- **Must not require a decision that is still open.** Anything chosen under time pressure
  should be cheap to change.
- **Must not touch an existing DNS record.** Additive only.

### What it must do, that is easy to skip

- **A privacy notice**, however short, and a lawful basis for holding the addresses. This
  is the first time the club collects personal data on its own infrastructure and the
  pattern set here is the one everything else copies.
  [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) applies from the
  first row.
- **A stated purpose.** "We will email you when entries open" — and nothing else, unless
  separately consented to. An interest list is not a mailing list.
- **A way to be removed.** An address to write to is sufficient at this size.
- **Two people with access**, from the first day. The whole point is not to build a fifth
  system [reachable by one person](../foundations/current-state.md#accounts-and-access).

---

## The stack, and why deciding it now is safe

**Astro on Cloudflare Workers, writing to Supabase Postgres in `eu-west-2`** — the target
recommendation from [platform
options](../solutions/platform-options.md#option-c--cloudflare-for-serving-supabase-for-data-recommended).

Choosing the target stack rather than the quickest one looks like it violates *"must not
require a decision that is still open"*. It does not, and the reasoning is worth setting
out:

| | |
| --- | --- |
| **The stack costs nothing at this stage** | Cloudflare free and Supabase free both cover this comfortably, and Cloudflare's terms permit payments later without a move |
| **It is cheap to be wrong** | A page and a table. If the club later chooses Netlify, an Astro site changes adapter in an afternoon and the table does not move at all |
| **The alternative is a guaranteed second migration** | Building on Vercel Hobby means moving before September, under more pressure, with the same decision still to make |
| **The data does not move regardless** | Supabase Postgres is the convergence point with the timing platform under every option except Cloudflare-bundled |
| **It proves the pattern at low stakes** | Better to discover the awkward parts of a new deployment on a sign-up form than on the club's live website in March |

**What is genuinely still open** — Cloudflare versus Netlify — **does not affect this
build.** Both serve a subdomain from a CNAME at Fasthosts, both build from git, and both
run the same Astro output. The decision that would be expensive to defer is the *data*
one, and that is already settled by the timing platform.

**No longer a constraint:** Cloudflare **Pages** accepted a custom subdomain
on a zone hosted elsewhere; Cloudflare **Workers custom domains** do not. While the zone
stays at Fasthosts, this must be a Pages project. See [platform options, item
4](../solutions/platform-options.md#validation-register).

---

## Build plan

Two weeks, with the second week mostly slack — which is deliberate, because the first week
contains all the things that go wrong in an unfamiliar deployment.

### Week 1 — make it exist

| | |
| --- | --- |
| **Accounts, before any code** | Club-owned Cloudflare account. **Both volunteers as admins on both Cloudflare and Supabase from the start** — not added later, because "later" is how the club ended up with four single points of failure |
| **Repository** | In the club GitHub organisation, not a personal account. Pull requests from the first commit |
| **Scaffold** | Astro, TypeScript, Cloudflare adapter. Deploy an empty page and confirm the pipeline works before writing content |
| **Hostname** | Associate the domain in Cloudflare, add **one CNAME** at Fasthosts. Confirm the old site and club email are untouched — they will be, but confirm it |
| **Content** | The race, the date, the distance, the course, the cost, what happens next |
| **Form and table** | Name, email, consent, timestamp. Server-side validation. Nothing else stored |
| **Privacy notice** | Short, honest, linked from the form |

### Week 2 — make it right

| | |
| --- | --- |
| **Accessibility** | [WCAG 2.2 AA](../foundations/requirements.md#users): semantic markup, real contrast, keyboard navigation, a form that works without JavaScript |
| **Phones on poor signal** | Static-first, small payload, no heavy client bundle. This is the club's actual audience |
| **Test the form properly** | Duplicate submission, malformed address, empty fields, submission with JavaScript disabled |
| **Confirm the data** | Rows are where they should be, both volunteers can read them, and a deletion request can be honoured |
| **Write down what was done by hand** | Every account created and token issued, per the [pragmatic exception](../foundations/requirements.md#everything-is-defined-as-code). This is the record a third volunteer reads |
| **Slack** | Deliberately unallocated |

### What "done" looks like

A runner who has never heard of the club can find the page on their phone, understand what
the race is, leave their name and email, and be told what happens next — and two
volunteers can both see the resulting list.

---

## Version 2 — entries and payment

Not in the two weeks. Blocked on things that are not code.

| Blocked on | Status |
| --- | --- |
| [Governance gates](../foundations/requirements.md#legal-and-governance) — data-protection advice and treasurer-controlled payment arrangements | **Not satisfied.** Nothing about payment starts before these |
| A host whose terms permit payment | Settled by the hosting decision |
| The payments decision — processor and flow | Priced in [platform options](../solutions/platform-options.md#what-payments-actually-cost), not decided |
| The race date | **Unconfirmed** |
| Entry price | Assumed £8–£10, **unconfirmed** |
| England Athletics status pricing | Needs [C11](../foundations/requirements.md#c11--verify-england-athletics-registration) or the export fallback |

**The fields an entry needs are genuinely more than a name and an email** — age bands for
the Vet 40/50/60 categories mean date of birth, and a mass-start road race means emergency
contact details. That is a materially heavier data-protection position than v1, and it is
the reason v1 deliberately does not collect them.

**If the gates are not satisfied by early September, use Full On Sport for 2026.** That
decision should be taken on a date, by a person, not left to drift.

---

## Version 3 — timing and results

Furthest out, and the one place where care matters more than speed.

The timing platform **works** and is [race-day
critical](../foundations/requirements.md#risk). NN needs three things from it that Pass
the Buck did not:

| | |
| --- | --- |
| **Solo format** | `events.format` already supports `solo`; the leaderboard's derivation is [relay-shaped](../foundations/current-state.md#the-race-timing-platform) and needs work |
| **Age-band categories** | Vet 40/50/60, male and female. **These do not exist** — current categories are pair-derived. This is the real build |
| **Timezone under a clocks change** | Already pinned through a single tested path. If the race lands on 25 October it is tested for real, on the day, once |

Two hardcoded assumptions also need removing: `LOCATION_LABEL = "Ashton Court"` and an
evening start.

**None of this justifies moving the timing platform's hosting.** It works where it is, its
free tier is legitimate because it takes no money, and
[priorities](priorities.md#what-can-safely-be-decided-later) is right that its permanent
home can be decided later. Add the solo and age-band work where it lives; move it in a
quiet season, with a full race simulation, away from any race.

---

## What could go wrong, and what it would cost

| | Likelihood | Cost | Mitigation |
| --- | --- | --- | --- |
| The CNAME is added wrong | Low | Minutes — NN does not resolve | Delete it. Nothing existing is touched |
| Cloudflare Pages will not serve the subdomain from Fasthosts DNS | Low | A day, and a switch to Netlify | [Confirm before starting](../solutions/platform-options.md#validation-register) |
| The race date changes after the page is published | **Moderate** | An edit and an email to the interest list | Publish the date only once it is committed |
| Payments are not ready for September | **Moderate** | Nothing, if decided early | Full On Sport for 2026 |
| The form collects too much | Moderate | A data-protection problem the club created itself | Name and email. Nothing else. Enforce it at review |
| Only one volunteer has access | Moderate — it is how every other system ended up that way | A fifth single point of failure | Both admins on both accounts on day one |
| Two weeks becomes six | Moderate | NN sells for fewer weeks | Scope is one page and one form. Resist everything else |

---

## Open questions this raises

Blocking, in order of how cheap they are to answer:

1. **What is the 2026 race date?** Everything moves with it, and 25 October is
   clocks-change morning. *Costs a committee decision.*
2. **What does the club want the page to say?** The only genuine unknown in v1. *Costs a
   conversation.*
3. **Full On Sport or the club's own entries for 2026?** Decide by end of August, not in
   September. *Costs a treasurer conversation.*
4. **What is the entry price**, and does it vary by England Athletics status? *Costs a
   committee decision.*
5. **Cloudflare or Netlify?** Does not block this build — but it should be settled while
   the pressure is off. See [DNS and
   domain](../solutions/dns-and-domain.md#should-the-club-move-dns-at-all).

And one that blocks nothing here but should be done in the same fortnight because it is
free: **move the timing repository into the club organisation**, and put a second person
on every account. It is the only item in this programme that [gets worse purely with the
passage of time](priorities.md#what-can-safely-be-decided-later).
