# Requirements

What the club needs the platform to **do**, and what bounds how it may do it. No vendors,
no products, no architecture.

This exists so that choices can be judged against something, and re-judged later without
starting over. If a requirement here is wrong, that is a bigger problem than any vendor
choice made underneath it.

Baseline facts are in [current state](current-state.md).

---

## Capabilities

Ten things the platform must do. Each says what it is, what makes it harder than it looks,
and how the club would know it works.

### C1 — Publish club information publicly

About, membership, training sessions, news, contact. Readable on a phone.

*Harder than it looks:* committee members can edit these today by clicking. Any replacement
either preserves that or has an answer for why it does not.

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

*Harder than it looks:* the fields needed differ by race (age bands need age; a relay needs
pairs). Entry data is personal data, which brings C10 and the governance gates with it.

*Done when:* on race morning the registration desk works from a roster that was always the
club's, with no import step.

### C4 — Take payments

Two different problems that need not share an answer:

- **Recurring membership** — small (£2.50), high-volume, long-lived, 94 existing mandates
  that cannot be transferred and must be re-established individually.
- **One-off race entries** — larger, from non-members, at the moment of entry, priced by
  England Athletics status.

*Harder than it looks:* fixed per-transaction fees dominate small payments — the difference
between monthly and annual membership pricing matters more than the choice of processor.
Card data must never touch club systems. The treasurer must be able to reconcile.

*Done when:* money arrives in a club account under treasurer oversight, reconcilable
against members and entrants, with a written refund policy behind it.

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

A public leaderboard updating within about a second of a marshal's tap, for people standing
at the finish and for family watching from home.

*Harder than it looks:* this is the one capability that needs **live push to browsers**, not
just request/response. It is the least substitutable thing in the stack.

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

*Harder than it looks:* requires DNS records the club controls, and interacts with existing
mail — the domain already has SPF, DKIM and DMARC for a different provider.

*Done when:* a message sent by the platform arrives and passes authentication checks.

### C9 — Store files

CSV import audit trails today; race photographs later.

*Harder than it looks:* photographs of identifiable people are personal data. This
capability grows a governance dimension the moment it is used for images.

*Done when:* files are retrievable, access-controlled, and covered by the retention policy.

### C10 — Hold personal data lawfully

Names, ages, England Athletics numbers, emergency contacts, email addresses, payment
records. Collected minimally, retained to a written policy, deletable on request.

*Harder than it looks:* this is not a feature, it is a condition on everything else. It
constrains where data may live, what may be logged, and what may exist outside production.

*Done when:* there is a privacy notice, a retention policy, a lawful basis, and no personal
data anywhere it is not needed.

### C11 — Verify England Athletics registration

Confirm a runner's URN against their name and status, to price entries correctly and to
gate membership.

*Harder than it looks:* depends on an external body's agreement and lead time. Needs a
fallback that works without it.

*Done when:* an entry is priced correctly from a verified registration status, or from a
recent club member list if the interface is unavailable.

---

## Constraints

These bound *how* the capabilities may be met. They are why the obvious answer is often
wrong here.

### Money

The club's platform spend is measured in **tens of pounds a year, not hundreds**. Today's
club-borne total is ~£510–£890 including payment fees. Anything that adds a recurring
three-figure line needs to displace more than it costs.

This is the constraint that eliminates most of the enterprise-shaped answers. It also means
free tiers are load-bearing, so their *terms* — commercial use, inactivity, retention —
are architectural facts, not fine print.

### People

**One volunteer builds and maintains everything**, with a day job. A second volunteer must
be able to pick it up cold.

This makes "boring" a hard requirement rather than a preference. Mainstream, well
documented, widely known beats optimal. Every unusual choice is a tax on somebody who has
not been hired.

### Time

Two fixed points; everything else is dependency-ordered rather than dated. See
[priorities](priorities.md).

### Risk

**The timing platform is proven in production and race-day critical.** A race happens once
a year and cannot be re-run. This asymmetry — cheap to break, impossible to un-break —
justifies treating anything that touches race day differently from everything else.

### Continuity

**The results archive is permanent.** Whatever holds it must not sleep, expire, or lose data
without a restorable backup. A URL published in 2026 should resolve in 2036.

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

### Compatibility with what exists

The timing platform is written in a specific framework against a specific data model. That
is not immovable, but changing it costs real volunteer time and re-opens proven, race-tested
code. Divergence should be a deliberate decision with a stated benefit, not a side effect.

### Users

Runners, marshals, members and spectators, on phones, often on poor mobile signal, sometimes
in bright sunlight with cold hands. Accessibility is part of this: semantic markup, real
contrast, keyboard navigation, WCAG 2.2 AA.

### Time and timezone

All timestamps stored in UTC, displayed in `Europe/London`. A race sits on the clocks-change
weekend, which makes this a correctness requirement rather than a formatting preference.

---

## What the club is not asking for

Stating these prevents solutions being judged against imaginary requirements.

- **Not a general-purpose CMS.** Editing convenience is a real requirement (C1); a
  content-management product is not the only way to meet it.
- **Not scale.** Roughly 100 teams, 150 solo entries, 94 members, a few hundred spectators
  on race night. Anything designed for scale is being paid for in complexity the club does
  not need.
- **Not high availability.** The website being down for an hour is an inconvenience. The
  timing app being down during a race is not, but that is one evening a year and is handled
  by the offline queue rather than by uptime engineering.
- **Not rebuilding the timing app.** It works.
- **Not a mobile app.** A phone browser is the delivery mechanism.
