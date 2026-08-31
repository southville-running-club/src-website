# Requirements

*Written August 2026. Most capabilities below are now built; a few have been narrowed or
withdrawn by a committee decision since — each is marked in place rather than the
requirement being silently rewritten. For which is which, cross-check against [the
phases](../delivery/phases.md).*

What the club needs the platform to **do**, and what bounds how it may do it. No vendors,
no products, no architecture.

This exists so that choices can be judged against something, and re-judged later without
starting over. If a requirement here is wrong, that is a bigger problem than any vendor
choice made underneath it.

Baseline facts are in [current state](current-state.md); the destination these serve is in
[target state](target-state.md).

---

## Capabilities

What the platform must do. Each says what it is, what makes it harder than it looks, and
how the club would know it works.

**Derived from what the current site actually does**, not from what a club website is
assumed to need — see [current state](current-state.md#what-is-actually-on-it). Several of
these were missing from earlier drafts because the site was never inventoried.

### C1 — Publish club information publicly

About, membership, training sessions, news, contact. Readable on a phone.

*Harder than it looks:* committee members can edit these today by clicking. Any
replacement either preserves that or has an answer for why it does not.

*Done when:* everything on the current site is reachable, and every existing URL still
resolves.

### C2 — Publish race results permanently and automatically

A page per race per year, at a stable public URL that never changes. Past years, course
records, year-on-year comparison. Derived from timing data rather than re-keyed.

*Harder than it looks:* "permanently" is a real constraint. It rules out anything that
sleeps, expires, or depends on somebody remembering to publish. It also means the results
data and the publishing surface must be able to reach each other.

*Done when:* every past event has a stable URL, and a new event's results appear without
anyone copying anything.

### C3 — Accept race sign-ups and entries

Collect the fields the race and its categories actually need, at the moment of entry, into
the club's own records. Replaces exporting a CSV from a third party and importing it.

*Harder than it looks:* the fields needed differ by race (age bands need age; a relay
needs pairs). Entry data is personal data, which brings C10 and the governance gates with
it.

*Done when:* on race morning the registration desk works from a roster that was always the
club's, with no import step.

### C4 — Take payments

**Four** distinct money flows, not one. They need not share an answer.

| Flow | Shape | Today |
| --- | --- | --- |
| **Session subscription** — £2.50/month | Small, recurring, cancellable at will, **open to non-members** | Squarespace donation fund, **~1,175 payments/yr measured** — not the 94 the proposal carried, see [current state](current-state.md) |
| **SRC membership** — £4/year | Annual, confers benefits, tied to an identity | Not taken online; forms plus the EA portal |
| **Race entries** — £18 affiliated, £20 unaffiliated (confirmed 24 Aug 2026, decision 006) | One-off, from non-members, priced by claimed affiliation rather than a verified EA status — see C11 | The club's own entry form |
| **Merchandise and tickets** | Occasional, physical or admission, needs stock and sizes | Squarespace commerce; kit via an external link |

*Harder than it looks:* the £2.50 subscription **is not membership** and its payers are
not a membership list — conflating them will produce a wrong data model. Fixed
per-transaction fees dominate small payments, so the difference between monthly and annual
pricing matters more than the choice of processor. Card data must never touch club
systems. The treasurer must be able to reconcile all four flows.

*Done when:* money arrives in a club account under treasurer oversight, reconcilable
against members, subscribers, entrants and buyers, with a written refund policy behind it.

### C5 — Capture race timing data, tolerant of no signal

Marshals on their own phones, at a line, in a crush, on whatever mobile signal a field
offers. No crossing may be lost.

*Harder than it looks:* **this already exists and works.** It is the single most valuable
asset the club has. The requirement is really "do not regress it" — the offline queue, the
idempotent retry, the never-block anomaly handling and the millisecond capture are all
load-bearing and were learned the hard way.

*Done when:* it still passes a full manual race simulation, including deliberate
connectivity loss and a run against a real race date.

### C6 — Show live race progress to spectators

A public leaderboard updating within about a second of a marshal's tap, for people
standing at the finish and for family watching from home.

*Harder than it looks:* this is the one capability that needs **live push to browsers**,
not just request/response. It is the least substitutable thing in the stack.

*Done when:* two browsers agree within a second, under the load of a full field's
spectators.

### C7 — Authenticate and authorise staff

Marshals and admins, on their own devices, without passwords to distribute or lose. Roles
must distinguish who may capture from who may administer.

*Harder than it looks:* small user base (single figures), but it gates race-day-critical
surfaces, so a lockout on race morning is a serious failure.

*Done when:* a new marshal can be onboarded and revoked without a developer.

### C8 — Send email as the club

Membership acknowledgements, entry confirmations, welcome messages, magic links. From a
club address, arriving in inboxes rather than spam.

*Harder than it looks:* requires DNS records the club controls, and interacts with
existing mail — the domain already has SPF, DKIM and DMARC for a different provider.

*Done when:* a message sent by the platform arrives and passes authentication checks.

### C9 — Store files

CSV import audit trails today; race photographs later.

*Harder than it looks:* photographs of identifiable people are personal data. This
capability grows a governance dimension the moment it is used for images.

*Done when:* files are retrievable, access-controlled, and covered by the retention
policy.

### C10 — Hold personal data lawfully

Names, ages, phone numbers, emergency contacts, email addresses, payment records, medical
notes under their own consent. **Not England Athletics numbers** — decision 007 stopped
that. Collected minimally, retained to a written policy, deletable on request.

*Harder than it looks:* this is not a feature, it is a condition on everything else. It
constrains where data may live, what may be logged, and what may exist outside production.

*Done when:* there is a privacy notice, a retention policy, a lawful basis, and no
personal data anywhere it is not needed.

### C11 — Verify England Athletics registration

⚠️ **Withdrawn for race entries, 29 August 2026** — [decision
007](../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers)
and
[ADR-023](../architecture/decisions/adr-023-no-england-athletics-numbers.md). The club asks
for no number and holds none: a runner states they are affiliated and the club takes their
word for it, reserving the right to ask for evidence. What follows is the requirement as
originally written, kept as the reasoning a fallback like this one might be revisited from,
not as a live capability.

Confirm a runner's URN against their name and status, to price entries correctly and to
gate membership.

*Harder than it looks:* depends on an external body's agreement and lead time. Needs a
fallback that works without it. Club policy also requires SRC membership before an EA
licence is issued, so the two are ordered.

*Done when:* an entry is priced correctly from a verified registration status, or from a
recent club member list if the interface is unavailable.

### C12 — Maintain membership records

Who is a member, when they joined, whether they are current, when they lapse. Distinct
from taking their money and distinct from the £2.50 subscription list.

*Harder than it looks:* the authoritative record currently lives in **England Athletics'
portal**, not the club's systems, and renewals happen there. Joining and cancelling are
web forms handled by hand. Membership confers the WhatsApp community and the discount
scheme, so "is this person current?" is a question the platform must be able to answer.

*Done when:* the Membership Officer can answer who is current without cross-referencing
three systems.

### C13 — Gate the members' community

Membership entitles someone to the WhatsApp community. Entry requires current membership,
a form, and agreement to a 12-point code of conduct.

*Harder than it looks:* the gate is only as strong as the invite link, and messaging
platforms do not expose membership management. Any enforcement is ours, not theirs — and
should be described honestly rather than as if it were airtight.

*Done when:* joining is a single flow from paid membership to being in the group, and
leaving membership can be reflected.

### C14 — Publish newsletters and club documents

**34 newsletters** since October 2023, and **29 documents** — the constitution, policies,
and AGM/QGM minutes running back to August 2015.

**Newsletters stay in Mailchimp.** The committee writes and sends there, and that does not
change. What changes is the mirroring: the site pulls the archive automatically instead of
somebody copying each one across by hand. That single change removes a manual process the
club is already failing to keep up with.

**Documents move onto the new site**, hosted by the club rather than on a platform's CDN.
Keep it simple to begin with — public, as they are now — with a members-only area
available later if the committee decides some should be restricted.

*Harder than it looks:* the archive is split across two providers — most documents are
PDFs on Squarespace's CDN, but **seven are on Google Drive**, outside club control. It is
also a limited company's public record, so losing part of it in a migration is a
governance problem, not just a broken link.

*Done when:* the newsletter archive updates itself, every document is held by the club at
a stable URL, and adding a document does not require a developer.

See [existing site inventory](../reference/existing-site.md).

### C15 — Sell merchandise and tickets

**Both are in scope to rebuild.**

**Kit** — seven items (buffs, t-shirts, vests, hi-viz variants) with sizes, male and
female cuts, prices, a buy-back policy and a held stock. Ordered in seasonal batches two
or three times a year, currently through an external link with **stock tracked by hand in
a table on a page**, and collected from a local shop.

**Tickets** — Summer and Christmas parties. Currently Squarespace commerce, with a cart,
checkout and customer accounts.

*Harder than it looks:* this is the largest single piece of build in the website. Sizes
and variants make kit a real catalogue rather than a button; batch ordering is not the
same shape as continuous stock; and both need fulfilment tracking, not just payment. It
also brings customer accounts and order history with it, which is state the current site
holds and a rebuild must either carry over or deliberately abandon.

*Done when:* an order can be placed, paid for and fulfilled without the Quarter Master
maintaining a table by hand, and a party ticket can be bought without Squarespace.

### C16 — Publish member benefits

A directory of around a dozen local businesses offering negotiated rates to members.

*Harder than it looks:* it changes as deals come and go, which makes it exactly the sort
of content the committee will want to edit without a developer.

*Done when:* the Membership Officer can add or amend a discount unaided.

### C17 — Collect form submissions

New member, cancel membership, WhatsApp community join, mailing-list subscription, and
whatever comes next.

*Harder than it looks:* every one of these collects personal data, so C10 applies. They
are also the club's main inbound channel and the thing most likely to be quietly broken by
a migration.

*Done when:* submissions reach the right officer reliably, and are retained to the policy.

---

### C18 — Reduce manual work

Every process in the club's [manual-process
list](current-state.md#manual-processes) that a system could do instead: validating a
WhatsApp request against membership, processing joiners and leavers, publishing results,
importing entries, mirroring newsletters, reconciling payments.

*Harder than it looks:* automating a process means encoding a rule somebody currently
applies by judgement, so each one has to be pinned down before it can be automated. Some
should not be — a human check on a new member may be the point rather than the overhead.

*Done when:* the Membership Officer is not cross-referencing systems by hand, and the
newsletter archive stops drifting.

**This is where most of the value is.** The subscription fee is the visible cost;
volunteer time is the larger one, and it appears on no invoice. See [problem
statement](problem-statement.md#3-volunteers-are-doing-work-the-system-should-do).

---

## Constraints

These bound *how* the capabilities may be met. They are why the obvious answer is often
wrong here.

### Everything is defined as code

**This is a foundational requirement, not an implementation preference.** The platform's
infrastructure, configuration, schema and deployment are defined in version control and
changed by a reviewed commit.

It is what the club is actually buying. The current site's state lives in a browser
session: no history of what changed, no review before it goes live, no rollback, and no
way for a second person to see what the first did. Recreating that on different technology
would gain the club almost nothing.

What follows from it:

- **Reviewable** — a change is proposed, seen by the other volunteer, and merged. Shared
  ownership is a property of the workflow, not a promise.
- **Testable** — if it is code, it can be tested, and a change can be verified before it
  reaches members.
- **Reversible** — every change has a previous state to return to.
- **Reusable** — patterns established once serve the website, Nightingale Nightmare and
  the timing platform rather than being solved three times.
- **Legible to tooling** — a codebase with its decisions written down is one that
  automated assistance can work in productively, which is how two volunteers with day jobs
  cover more ground than two volunteers otherwise would.
- **Decisions are documented** — see the [decision log](../decisions/decision-log.md).

A pragmatic exception, stated so it does not become a slow leak: **a small amount of
manual setup is accepted** — creating an account, issuing an API token, a registrar action
that has no interface. Where that happens it is documented in the repository: what was
done, why, by whom, and how to redo it. Anything routinely done by clicking is a gap to
close, not a way of working.

### Shared ownership

**No system may be reachable by only one person.**

Today four are: the domain, DNS and email sit with one volunteer; the database, hosting
and England Athletics record sit with the other. Neither can cover for the other, and the
club cannot reach either without them.

This is a requirement on *how* things are set up, not only on who holds passwords:
club-owned accounts rather than personal ones, code in the club's organisation rather than
an individual's, and access granted by role.

### Money

The club's platform spend is measured in **tens of pounds a year, not hundreds**. Today it
pays **£204** for the website and **£15.40** for the domain and DNS, plus payment fees on
every transaction. Anything that adds a recurring three-figure line needs to displace more
than it costs.

This is the constraint that eliminates most of the enterprise-shaped answers. It also
means free tiers are load-bearing, so their *terms* — commercial use, inactivity,
retention — are architectural facts, not fine print.

### People

**Two volunteers build and maintain the platform**, both with day jobs — the Web Manager
(who built the current site and holds domain and DNS access) and the Membership Officer
(who built the race-timing system). Knowledge and access are currently **split** between
them rather than shared.

Two is materially better than one, and it changes what is affordable: some operational
burden is now bearable, and there is somebody to review a change. It does not remove the
constraint. Both have day jobs, the club is a volunteer organisation, and a third person
must be able to pick this up cold.

So "boring" stays a hard requirement rather than a preference. Mainstream, well
documented, widely known beats optimal. Every unusual choice is a tax on somebody who has
not been hired.

**The split is itself a risk.** Access to each critical system currently sits with one
person, so the club has two single points of failure rather than one shared capability.

### Time

Two fixed points; everything else is dependency-ordered rather than dated. See
[priorities](../delivery/priorities.md).

### Risk

**The timing platform is proven in production and race-day critical.** A race happens once
a year and cannot be re-run. This asymmetry — cheap to break, impossible to un-break —
justifies treating anything that touches race day differently from everything else.

### Continuity

**The results archive is permanent.** Whatever holds it must not sleep, expire, or lose
data without a restorable backup. A URL published in 2026 should resolve in 2036.

**The old site runs until the club is satisfied with the new one.** They coexist; there is
no big-bang switchover. That is a constraint on how the replacement is built and
addressed, not merely a rollback plan.

**Nothing may be lost in the move.** Every image, document and newsletter currently on the
site is held on a platform CDN — cancelling the subscription deletes them. Retrieving the
lot while the subscription is live is a prerequisite, not a cleanup task. See the
[existing site inventory](../reference/existing-site.md#what-the-site-depends-on).

### Legal and governance

- No payment work before data-protection advice and treasurer-controlled payment
  arrangements exist.
- The member fund must be re-homed before Squarespace is cancelled.
- Personal data implies UK/EU residency preferences and a retention policy.

### Exit cost

**No capability may become unrecoverable.** For each choice the club should be able to
answer: *if this vendor doubles its price, changes its terms, or disappears — what does it
cost to leave, and is the data portable?*

This is a first-class criterion, not an afterthought. It is what makes a vendor choice
reversible rather than permanent, and it is how a small club stays safe while depending on
free tiers.

### Convergence

**The end state is one platform.** The race-timing system, Nightingale Nightmare and the
club website are intended to merge — one place, not three things that happen to share a
club. This is a stated goal, not merely an option, and it means any interim arrangement
should be judged partly on how cheaply it converges later.

The timing platform functions well but currently sits on its own hosting and its own
database. Its framework and data model are the incumbent; changing them costs real
volunteer time and re-opens proven, race-tested code. Divergence should be a deliberate
decision with a stated benefit, not a side effect.

### Users

Runners, marshals, members and spectators, on phones, often on poor mobile signal,
sometimes in bright sunlight with cold hands. Accessibility is part of this: semantic
markup, real contrast, keyboard navigation, WCAG 2.2 AA.

### Time and timezone

All timestamps stored in UTC, displayed in `Europe/London`. A race sits on the
clocks-change weekend, which makes this a correctness requirement rather than a formatting
preference.

---

## What the club is not asking for

Stating these prevents solutions being judged against imaginary requirements.

- **Not a general-purpose CMS.** Editing convenience is a real requirement (C1); a
  content-management product is not the only way to meet it.
- **Not scale.** Roughly 100 teams, 150 solo entries, ~1,175 subscription payments a year
  (see [current state](current-state.md), not the proposal's 94), a few hundred spectators
  on race night. Anything designed for scale is being paid for in complexity the club does
  not need.
- **Not high availability.** The website being down for an hour is an inconvenience. The
  timing app being down during a race is not, but that is one evening a year and is
  handled by the offline queue rather than by uptime engineering.
- **Not rebuilding the timing app.** It works.
- **Not a mobile app.** A phone browser is the delivery mechanism.
