# Decision log

Where choices get recorded once they are made — and, just as importantly, how they get
**re-opened** when the ground shifts.

**Nothing is recorded here yet.** [Requirements](../foundations/requirements.md) and
[options](../solutions/options.md) come first; decisions come after. That order is the
point of this branch.

---

## What gets a record

A choice needs one if it:

- picks a vendor, framework, language or infrastructure primitive;
- changes where personal data lives;
- would be expensive or slow to reverse;
- or commits the club to a recurring cost.

Small, reversible choices do not. If reversing it costs an afternoon, just make it.

## The shape of a record

Each decision states:

| Section | What goes in it |
| --- | --- |
| **Requirement** | Which capability from [requirements.md](../foundations/requirements.md) this serves |
| **Context** | The facts that forced a choice. Numbers where numbers exist |
| **Options** | What was genuinely considered, with the trade-off for each |
| **Decision** | What we are doing, in the present tense |
| **Consequences** | What becomes true — including the costs knowingly accepted |
| **Exit cost** | **What it takes to undo this, and whether the data comes with us** |
| **Revisit when** | The condition that reopens it |

Two of those are unusual and deliberate.

**Exit cost is mandatory.** A club running on free tiers is exposed to terms changing
under it. The defence is not choosing perfectly — it is knowing, for every choice, what
leaving would cost. A decision whose exit cost nobody can state is a decision nobody can
safely review.

**"Revisit when", not "revisit if".** A condition, not a hope. *"When the free tier stops
permitting payments"* is a trigger somebody can notice. *"If it becomes a problem"* is
not.

---

## Re-evaluating

The point of separating requirements from options from decisions is that a decision can be
re-opened **without re-doing the thinking underneath it**.

To re-evaluate a choice:

1. **Check the requirement still holds.** Often the surprise is that the requirement
   moved, not the market. A decision that no longer serves a requirement is not a bad
   decision — it is a finished one.
2. **Re-score the options against the same criteria** in
   [options.md](../solutions/options.md). Same criteria, or the comparison means nothing.
3. **Price the exit** using the record's own exit-cost section. Compare that against what
   staying costs.
4. **Write a new record** that supersedes the old one, naming what it replaces. Never edit
   an accepted decision to change its answer — the history of a choice that turned out
   badly is worth more than a tidy file.

### Triggers worth watching

Conditions that should prompt a re-read regardless of whether anyone feels like it:

- A free tier changes its terms — particularly around commercial use, inactivity, or
  retention.
- A recurring cost appears, or an existing one moves materially.
- A second maintainer arrives. Several trade-offs here are made *because* there is one
  volunteer, and they should be revisited when that stops being true.
- A capability in [requirements.md](../foundations/requirements.md) is added, removed or
  changes shape.
- Something breaks in a way a different choice would have prevented.
- The club's data-protection position changes.

### When re-evaluation is not worth it

Re-opening a decision has a cost of its own — attention, and the risk of half-finished
migrations. Not worth it when the exit cost exceeds several years of the saving, when the
current choice is merely inelegant rather than failing a requirement, or when the person
proposing the change will not be the one maintaining the result.

**Boring and settled beats optimal and re-litigated**, for a club maintained by
volunteers.

---

# Records

Proposed by the Web Manager, 7–8 August 2026. **Not yet ratified by the committee** — the
[governance gates](../foundations/requirements.md#legal-and-governance) still stand, and
nothing here authorises payment work.

---

## 001 — Serve the website from Cloudflare, and move the domain's DNS there

| | |
| --- | --- |
| **Requirement** | [C1](../foundations/requirements.md#c1--publish-club-information-publicly), [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), and the [money constraint](../foundations/requirements.md#money) |
| **Context** | The incumbent pattern — Vercel Hobby — [prohibits commercial use](../solutions/platform-options.md#1-does-the-free-or-cheap-tier-permit-taking-payments), and paying for it properly costs more than staying on Squarespace. Cloudflare's terms permit payments on the free tier. Serving the apex requires Cloudflare to be authoritative for the zone |
| **Options** | Compared in [platform options](../solutions/platform-options.md#the-complete-cost-picture); the final two head-to-head in [Cloudflare or Netlify](../solutions/cloudflare-vs-netlify.md) |
| **Decision** | Cloudflare serves the site. Authoritative DNS moves from Fasthosts to Cloudflare, following the [staged runbook](../solutions/dns-and-domain.md#what-moving-the-apex-to-cloudflare-actually-involves). Registration stays at Fasthosts for now |
| **Plan** | **Workers Paid, $5/month (~£47/yr). The Cloudflare zone stays on the Free plan** — the Pro zone plan is a different product at ~£190/yr and buys the club nothing |
| **Consequences** | DNS becomes code and lands in a club-owned account both volunteers can reach — closing the last click-operated single point of failure. Accepts a one-off migration that carries club email, reversible only over 48 hours. Until the nameservers move, anything on the club domain must be a **Pages** project, not a Worker |
| **Exit cost** | **Low on serving** — static output moves to Netlify in an afternoon. **Moderate on DNS** — moving the zone back is another nameserver change with the same care |
| **Revisit when** | Cloudflare's free tier gains a commercial-use restriction; or a Cloudflare outage affects the club materially |

## 002 — Hold the club's data in Supabase, on the free tier

| | |
| --- | --- |
| **Requirement** | [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully), [C12](../foundations/requirements.md#c12--maintain-membership-records), and [convergence](../foundations/requirements.md#convergence) |
| **Context** | The timing platform already runs on Supabase Postgres in `eu-west-2`. Keeping Postgres means the website and the timing platform converge without re-opening race-tested code. Cloudflare D1 would cost the same and break that |
| **Decision** | Supabase Postgres, `eu-west-2`, **free tier**. Website and timing data in one project |
| **Consequences accepted** | 500 MB, and **Realtime capped at 200 concurrent connections**. Inherits the existing bundling exposure rather than creating a new one |
| **Binding design constraint** | **The live race leaderboard must be served from Cloudflare — Durable Objects or equivalent — not Supabase Realtime.** A race-night crowd would exceed 200 connections and force Supabase Pro at £237/yr. This decision only holds if [C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) is built that way |
| **Also** | Files go to R2, never into Postgres. That is the other way to reach the free-tier ceiling |
| **Exit cost** | **Low for the data itself** — a standard Postgres dump. Higher if Supabase Auth and Realtime become load-bearing |
| **Revisit when** | The database approaches 500 MB; Realtime concurrency is needed beyond 200; or the free tier's terms change |

## 003 — Buy mailboxes from Fasthosts

| | |
| --- | --- |
| **Requirement** | [C8](../foundations/requirements.md#c8--send-email-as-the-club), and [shared ownership](../foundations/requirements.md#shared-ownership) |
| **Context** | Club mail is forwarding-only into personal Gmail accounts, so replies leave from a volunteer's address, forwarding breaks SPF, and no archive is club-held. **Cloudflare sells no mailbox product**, so moving DNS there does not answer this |
| **Options** | [Email](../solutions/email.md#options) — costed at two mailboxes and at six role addresses, because per-user pricing and flat-rate pricing diverge sharply |
| **Decision** | **Fasthosts Standard Email**, ~£26–£33/yr, two role mailboxes, used through Gmail *Send mail as* so replies leave from the club address SPF-aligned. Transactional mail stays separate, on Resend, from a dedicated sending subdomain |
| **Why not Migadu** | **Migadu was proposed first and dropped the same day.** Its flat-rate model fits a committee of many roles and few people, and £15 looked decisive — but Micro sends only **20 messages a day**, which is exactly what the club would be buying it for, and Mini costs £71. **Fasthosts needs no MX change**, and removing a second mail-affecting change from a programme that already has one is worth more than £15/yr |
| **Consequences** | **No MX change — the club's mail routing does not move.** Fasthosts remains a vendor, which it is anyway as registrar. Mailboxes are bought *before* the nameserver move, so Fasthosts configures its own records while it still controls the zone and the club copies one settled, verified zone into Cloudflare |
| **Exit cost** | **Low.** Export mailboxes, repoint MX. Standard IMAP, no lock-in |
| **Revisit when** | Fasthosts will not state its sending limits, or they are worse than 20/day; a third mailbox costs more than a whole Migadu plan; or the registrar moves away from Fasthosts, at which point the consolidation argument disappears |

## 004 — Run the new site alongside the old, and switch in one moment

| | |
| --- | --- |
| **Requirement** | [Continuity](../foundations/requirements.md#continuity) — *"the old site runs until the club is satisfied with the new one. They coexist; there is no big-bang switchover"* |
| **Context** | The member fund is the critical path: ~103 people must personally re-establish a payment, and **the list grows by about 45 payments a month.** A plan that migrates everyone at the end is migrating a larger number than a plan that starts early |
| **Decision** | The new site is built at **`new.southvillerunningclub.co.uk`, with paths mirroring the old site**, and runs alongside Squarespace throughout. **The payment page is built first**, and every new subscriber is sent to it from that day on |
| **Why the payment page first** | **It stops the old list growing.** Every month it is live is roughly 45 people who never join the list that has to be migrated. Nothing else in the plan changes a growing problem into a fixed one |
| **Consequences accepted** | `noindex` on `new.` until cutover, or the club's search results split — 314 visits a month arrive from Google. **Two payment sources reconciled** while the fund migrates; time-box it. `new.` must redirect to the apex afterwards so bookmarks are not stranded |
| **The cutover** | **One coordinated moment.** Squarespace **301-redirects every secondary domain to its primary**, so the old site cannot be reachable at `old.` while it still serves `www` — the primary-domain change and the apex repoint happen together, or the old site is simply left on its built-in `*.squarespace.com` address, which needs no DNS at all |
| **Exit cost** | **Near zero.** `new.` is a subdomain; abandoning it costs a DNS record |
| **Revisit when** | Parallel running has lasted long enough that reconciling two payment sources is a burden |

## 005 — Give the platform member accounts, on Supabase Auth

| | |
| --- | --- |
| **Requirement** | [C7](../foundations/requirements.md#c7--authenticate-and-authorise-staff), [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully), and [people](../foundations/requirements.md#people) |
| **Context** | Nothing on the platform signs in. The one surface that reads people, `/nn/admin`, is opened by two shared keys rather than an account — the answer [ADR-013](../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) already named as the one to reach *"the day the platform genuinely has members."* That day is now: entries want to open in early September, and the club wants a role-gated way to read them that is not a shared secret. [`principles.md`](../architecture/principles.md#stop-and-ask) has carried *"does the website need member-facing authentication?"* as a stop-and-ask since the skeleton, and [this folder's README](../architecture/decisions/README.md#what-is-waiting-to-be-recorded-here) has listed it as waiting since issue #1 |
| **Options** | Keep the two-key scheme and add more keys — cannot express partial permission, and cannot be self-service. Cloudflare Access in front of `/admin` — the best answer to identity on the list, refused in ADR-013 for having no equivalent in Miniflare or on a laptop, which stays true here. Roll our own accounts — password hashing, reset tokens, session rotation, maintained by two volunteers, and the widest possible miss on *boring beats optimal* |
| **Decision** | **Supabase Auth (GoTrue)**, already running locally with zero users. Email and password, Google, and magic link — all three ways in. Three roles and no more: `super-admin`, `nn-admin`, `member`. `admin@southvillerunningclub.co.uk` is bootstrapped to `super-admin` by migration, registering like anybody else. A new, exposed schema, `identity`, holds the person record and role — **not `club`**, which stays unexposed for the future membership list. `/account/` is what a member sees; `/admin/` is the staff backend. An account is a person; membership ([C12](../foundations/requirements.md#c12--maintain-membership-records)) stays a later, separate thing. Cloudflare Turnstile guards every unauthenticated account form |
| **Consequences** | Three costs knowingly accepted, each recorded in full in [ADR-015](../architecture/decisions/adr-015-member-accounts-on-supabase-auth.md): the account area requires JavaScript, breaking progressive enhancement for the first time; the session cookie moves from `SameSite=Strict` to `Lax`, because a magic link and an OAuth callback are both cross-site top-level navigations, so CSRF becomes real work rather than a cost `Strict` absorbed for free; and the `[auth]` block in `packages/db/supabase/config.toml` stops being inert, since `deploy-db.yml` already pushes it to production on every merge touching a migration. The two-key scheme in ADR-013 is not replaced — it stays available as a break-glass path until #63 retires it, after race day and after the change freeze lifts |
| **Exit cost** | **Low for the rows** — `identity` is a standard Postgres schema, exported like any other. **Moderate for the mechanism** — leaving Supabase Auth means re-issuing every session and re-registering every account elsewhere, and Google/magic-link sign-in would need re-wiring against a new provider. Turnstile is a single client call and swaps cheaply |
| **Revisit when** | Supabase Auth's free-tier terms change around emails sent per hour or accounts held; a fourth role is proposed, which is a migration and a decision on its own; or the two-key scheme is retired and this becomes the only door, at which point its own exit cost is worth re-pricing |

---

## What these decisions cost together

| | Per year |
| --- | --- |
| Cloudflare Workers Paid *(zone on the Free plan)* | £47 |
| Supabase — free tier | £0 |
| Fasthosts Standard Email — two mailboxes | £30 |
| Domain, still at Fasthosts | £15.40 |
| Card processing — Stripe at 1.5% + 20p | £335 |
| **Total** | **£427** |
| **Against £735 today** | **Saves £308 a year** |

Payment processing is shown because it changes with the platform — Squarespace Payments
cannot outlive Squarespace. It is not a decision taken here; see
[C4](../foundations/requirements.md#c4--take-payments), still behind the governance gates.

## What is still open

- **The GitHub account's shape** — `southville-running-club` is a shared personal login
  rather than an organisation — **and whether to pay for branch protection.** Two separate
  questions, both **left as they are on 9 August 2026, deliberately.** See below: they are
  the only open items here that are *technical controls* rather than prices
- **The registrar.** Fasthosts for now. Moving it is optional, later, and worth doing for
  consolidation rather than the ~£7
- **Fasthosts' sending limits and its price beyond two mailboxes**, neither published
- **Payments** — processor, flow, and whether Direct Debit replaces card on the £2.50
  subscription. That last one is worth ~£250/yr, more than all four decisions above
  combined
- **Five vendor facts** listed under
  [verify before deciding](../solutions/platform-options.md#validation-register), which
  should be confirmed in writing before any account is paid for

---

## Deferred — the GitHub account's shape, and what the free plan does not give us

**Raised 9 August 2026, while setting the repository up. Both left as they are, on
purpose.**

Two separate questions surfaced together and are easy to conflate. They are orthogonal:
one is about **who is accountable**, the other about **what is enforced**.

> **Both were found by trying to configure them**, which is the cheapest possible moment,
> and neither blocks anything. The pipeline works, the tests run, the deploys happen.

---

### Question one — `southville-running-club` is a personal account, not an organisation

**`type: User`.** The repository is owned by a shared personal login, with `chessser` and
`bindalshah` added as collaborators with write access.

That is **club-owned**, which is most of what
[shared ownership](../foundations/requirements.md#shared-ownership) asks for — either
volunteer can reach the code, and it does not sit in one person's name. But
[the principle](../architecture/principles.md#no-system-is-reachable-by-only-one-person)
asks for one thing more:

> Club-owned accounts rather than personal ones, code in the club's organisation, access
> granted by role, and **a named login each where the product supports one**.

**A shared account is a shared password.** Actions taken as `southville-running-club` are
attributable to nobody in particular, and the credential cannot be revoked for one person
without revoking it for both. That is a milder version of the problem this whole programme
exists to fix, and it is worth being honest that it is the same shape.

**Converting to an organisation is free**, and GitHub supports it directly: repositories
come across with their history and settings, and both volunteers become owners under their
own logins. Two catches:

- **You can no longer log in as `southville-running-club`.** It stops being a login and
  becomes a container. Both owners need their own accounts first — they have them.
- **Keys and tokens on the account do not carry over.** Nothing depends on them today, so
  the conversion is free right now. It stops being free once Cloudflare's GitHub App is
  bound to the account.

**Left as it is.** The account is club-owned, both volunteers can reach it, and the work in
front of the club is a race in ten weeks. Converting mid-setup would invalidate the login
being used to do the setup.

### Question two — enforcement, and it is *not* solved by converting

The natural assumption is that becoming an organisation brings branch protection. **It does
not.**

| Account shape | Repo | Branch protection? |
| --- | --- | --- |
| User, Free | private | ❌ |
| **User, Pro** | private | ✅ |
| **Org, Free** | private | ❌ — *no better than today* |
| Org, Team | private | ✅ |
| Either | **public** | ✅ **free** |

GitHub Free *for organizations* excludes protected branches on private repositories exactly
as GitHub Free for users does. Converting buys governance, not enforcement.

**And the pricing runs the other way from the intuition.** Pro is billed per *account*;
Team is billed per *seat*. Staying a personal account and buying Pro is one subscription;
converting and buying Team is two — roughly double, for the same enforcement. Figures are
approximate: GitHub does not publish them on its plans page, so **check billing before
committing to either.**

---

### What the free plan actually withholds

**Pull requests and code review work fine.** Open, review, comment, approve, request
changes — all available, today, at no cost. CI runs on every pull request and a red check
is visible on it.

What GitHub Free withholds on a private repository is **enforcement**:

| | |
| --- | --- |
| **Branch protection** | Nothing *requires* a pull request, *requires* CI to pass, or blocks a direct push to `main`. `403 — Upgrade to GitHub Pro or make this repository public` |
| **Actions environments** | *"Organizations with GitHub Team and users with GitHub Pro can configure environments for private repositories."* A workflow declaring one fails outright, so `deploy-db.yml` does not declare one |

> **The convention is available. Only its enforcement is not.**

### Why the environment half is the part that matters

Branch protection guards against a slip. The environment guards against something worse: it
is what would let the **other volunteer be a required reviewer on `supabase db push`** — a
second pair of eyes on the one automated action that can reach the timing platform's
database.

Without it, merging a migration applies it unsupervised. Two things narrow that and neither
closes it: migrations are scoped `--schema club,intake`, so this repository cannot propose
dropping the timing app's tables; and `supabase db reset`, the destructive one, is a local
command that appears in no workflow.

### The options

| | Cost | |
| --- | --- | --- |
| **A CI guard** | £0 | A workflow failing loudly when a commit reaches `main` without a pull request. Detection, not prevention. Does **not** give the migration reviewer |
| **GitHub Pro**, staying a personal account | ~£38/yr *(one account)* | Both. **The cheapest route to enforcement** |
| **Convert, then GitHub Team** | ~£77/yr *(two seats)* | Both, plus named logins. Roughly double, for the same enforcement |
| **Make the repository public** | £0 | Both, plus unlimited Actions minutes. Needs the [DNS zone export](../reference/zone-fasthosts-2026-08-08.txt) moved or redacted, and makes the club's infrastructure reasoning readable by anyone |

### Why both are left as they are

**The enforcement gap is one the club has already accepted elsewhere.**
[ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) chose
exactly this trade for DNS — a reviewable artefact and a runbook, with nothing technically
preventing somebody clicking — on the reasoning that *"for two volunteers who trust each
other, that is the acceptable gap."* Paying to close it here while accepting it there would
be inconsistent, and the club is spending this programme reducing £735/yr to £427.

**The account shape is a governance improvement, not a fix for anything broken.** The
account is club-owned and both volunteers can reach it. What it lacks is attribution, and
attribution matters most when something goes wrong — which is a reason to do it before the
platform carries real member data, not a reason to do it today.

**And the sequencing argues for waiting.** Converting invalidates the login currently being
used to set Cloudflare up. Doing it mid-setup would mean redoing the GitHub App
installation.

> **Nothing is blocked by leaving both open.** The pipeline works, the tests run, the
> deploys happen, and pull requests can be reviewed today.

### Revisit when

Conditions, not hopes — [the log's own standard](#the-shape-of-a-record).

**For enforcement:**

- **Before the first migration against real member data.** The unsupervised-migration risk
  is theoretical while `club` is empty, and stops being theoretical the day it is not.
  **This is the trigger most likely to fire first**
- **Somebody pushes to `main` by accident** — the evidence that the convention needs teeth
- **Any month the repository is made public for another reason**, since it comes free then

**For the account shape:**

- **A third person needs access.** A shared password cannot be granted to three people and
  revoked from one; this is the point at which the current arrangement stops working rather
  than merely being untidy
- **Either volunteer leaves the club**, since the shared credential goes with them
- **Before the timing platform moves in.** `src-race-timing` is in a personal account and
  has to move anyway; moving it once, into the final shape, is cheaper than moving it twice
- **The club buys GitHub Pro or Team**, since the plan choice and the account shape interact
  — Pro only helps a personal account, Team only an organisation
