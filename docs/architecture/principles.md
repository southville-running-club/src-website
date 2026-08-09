# Architectural principles — the as-is

**What is already true and stays true**, regardless of any open question.

This is the short document. If you are about to write code and only read one thing here,
read this one.

Everything below is either a
[requirement](../foundations/requirements.md), a
[decision already taken](../decisions/decision-log.md), or a pattern the
[timing platform already proves in production](../reference/timing-app-review.md). **None
of it is under discussion** — the arguments are in
[investigations](investigations/), and they are about the things *not* on this page.

Each entry says what the rule is, where it comes from, and — where it is easy to get
wrong — what breaking it actually costs.

---

## Non-negotiable

Breaking one of these is a defect, not a judgement call.

### Everything is defined as code

Infrastructure, configuration, schema and deployment live in version control and change by
a **reviewed commit**. Nothing routine is done by clicking.

*Where from:* [a foundational
requirement](../foundations/requirements.md#everything-is-defined-as-code) — *"it is what
the club is actually buying."* The current site's state lives in a browser session with no
history, no review, no rollback and no way for a second person to see what the first did.

*The accepted exception:* a small amount of manual setup — creating an account, issuing a
token, a registrar action with no interface. **Where it happens it is written into the
repository: what was done, why, by whom, and how to redo it.**

### No system is reachable by only one person

Club-owned accounts rather than personal ones, code in the club's organisation, access
granted by role, and a named login each where the product supports one.

*Where from:* [shared ownership](../foundations/requirements.md#shared-ownership). Four
systems are reachable by one person each today, and neither volunteer can cover for the
other.

### Row-level security is the access control

There is no API tier between the browser and Postgres. RLS **is** the enforcement, which is
what makes a public leaderboard possible without one.

| | |
| --- | --- |
| **Enabled on every table, from its first migration** | No exceptions, no "we'll add it later" |
| **The anon key is public** and appears in client code | This is fine. RLS is what protects the data |
| **The service role key never reaches the browser and never enters the repository** | If a build appears to need it, **the policy is wrong and that is the thing to fix** |
| **Helper functions live in a `private` schema with a pinned `search_path`** | The pattern the timing app already uses |
| **Policies are tested, including the negative case** | An anonymous client *failing* to read member data is the assertion that matters |

*Watch out for:* RLS recursion. The timing app carries [a migration existing specifically to
fix it](../reference/timing-app-review.md#row-level-security).

### Timestamps are stored UTC and displayed `Europe/London`

`TZ=UTC` is pinned in the test environment. Timezone conversion goes through **one tested
module**, never through an ambient `toLocaleTimeString`.

*Where from:* [a correctness requirement, not a formatting
preference](../foundations/requirements.md#time-and-timezone) — **Nightingale Nightmare
sits on or near the clocks-change weekend**, and the timing app's `lib/london-time.ts`
names the one-hour-drift foot-gun in its own comment.

### Personal data is minimised at the boundary

Sensitive fields are dropped **before** they reach the database, not stored and filtered
later. Date of birth becomes a computed age; address, phone, emergency contact and medical
information do not persist at all.

*Where from:* [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully), and
[the timing app already implements
it](../reference/timing-app-review.md#runners) at the CSV parser boundary — *"the pattern
any new entry surface should inherit."*

**Adding a column that holds personal data is a committee decision, not a build decision.**

### Files go in R2. Never in Postgres

*Where from:* [decision 002](../decisions/decision-log.md) — it is one of only two ways to
reach the free tier's 500 MB ceiling, and the other one is race-night concurrency.

### No payment code before the governance gates

No Stripe dependency, no price in a checkout, no button that takes a card — until
data-protection advice and treasurer-controlled payment arrangements exist.

*Where from:* [legal and
governance](../foundations/requirements.md#legal-and-governance). Free-tier commercial-use
terms also turn on this.

### DNS changes are additive until they cannot be

Add records; do not modify or delete existing ones. **Mail hostnames are never proxied.**
After any change touching the zone, **send and receive a test email before checking
anything else.**

**A record change is a pull request against the committed zone file, reviewed before anybody
opens a dashboard** — then applied by hand, then re-exported to confirm the file still
matches. [ADR-005](decisions/adr-005-manual-with-a-reviewable-artefact.md): the reviewable
artefact is what the requirement is asking for; the apply mechanism is not.

*Where from:* [DNS and domain](../solutions/dns-and-domain.md). An
[additive record](../foundations/glossary.md#domains-and-dns) cannot break anything, because
nothing resolved that name before — deleting it restores the previous state exactly.

### Expand, migrate, contract

Schema changes keep the previously deployed version working. **Roll code back; roll schema
forward.** No migrations during a race
[change freeze](../foundations/glossary.md#platform-and-delivery).

*Where from:* the [risk constraint](../foundations/requirements.md#risk), and the timing
app's registration migration
[already documents the ordering by hand](../reference/timing-app-review.md#what-is-strong)
because it hit a `42703` window in production.

### The timing platform is not touched by website work

Not its tables, not its policies, not its repository — until the port happens deliberately.

*Where from:* [risk](../foundations/requirements.md#risk). A race happens once a year and
cannot be re-run: cheap to break, impossible to un-break.

---

## Standing technical choices

Settled, and re-opening one needs a reason rather than a preference.

| | | Why |
| --- | --- | --- |
| **Language** | TypeScript, `strict: true` | [Convergence](../foundations/requirements.md#convergence) with the timing platform. One set of types for the same entities |
| **Data** | Postgres, Supabase, `eu-west-2` | [Decision 002](../decisions/decision-log.md). London for [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **One database** | Website and timing in one project, separated by schema | [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically) needs results *derived* from timing data, and two projects cannot join |
| **Serving** | Cloudflare | [Decision 001](../decisions/decision-log.md). Free tier permits commercial use; Vercel Hobby does not |
| **Files** | R2 | 10 GB free, **no egress charge** |
| **Data client** | `@supabase/supabase-js` | Already the club's client. A second data-access idiom for one database fails *boring* |
| **Validation** | Zod, one schema shared between client and server | **Server-side validation is never optional.** Client-side is a convenience, never a control |
| **Package manager** | npm, lockfile committed | [Boring is a hard requirement](../foundations/requirements.md#people). pnpm is better and less universally known |
| **Styling** | Vanilla CSS with custom properties | A third volunteer reads it cold. Smallest payload on poor signal |
| **Tests** | Vitest, Playwright, `@axe-core/playwright` | Astro's own defaults, plus accessibility tested rather than asserted |
| **CI** | GitHub Actions | Already where the club's code lives |

---

## How the platform is expected to behave

### Progressive enhancement, not JavaScript-dependence

A real `<form method="post">` that works with JavaScript disabled, enhanced afterwards if
useful.

*Where from:* [users](../foundations/requirements.md#users) — runners and marshals on
phones, on poor mobile signal, *"sometimes in bright sunlight with cold hands."*

### WCAG 2.2 AA, and zero accessibility violations

Semantic markup, real contrast, visible focus, labelled inputs, errors associated with
their fields, keyboard-operable throughout. **Zero axe violations, not "few"** — any
threshold above zero becomes the new normal within a month.

*Where from:* [users](../foundations/requirements.md#users). 70% of visitors are on a phone.

### Failure is designed for, not handled

The offline queue, the idempotent retry, and the never-block anomaly model exist because the
finish line is a crush on bad signal. **An offline capture must never look like an error, and
a real error must never look routine.**

*Where from:* [C5](../foundations/requirements.md#c5--capture-race-timing-data-tolerant-of-no-signal),
and [what the timing app already gets
right](../reference/timing-app-review.md#what-is-strong).

### Permanent means permanent

A URL published in 2026 resolves in 2036. Nothing holding the archive may sleep, expire, or
lose data without a **restorable** backup.

*Where from:* [continuity](../foundations/requirements.md#continuity). Note the open gap:
the Supabase free tier has no automated backups, and
[nothing is decided yet](investigations/database.md#backups).

### Every dependency has a stated exit cost

For each choice: *if this vendor doubles its price, changes its terms, or disappears — what
does it cost to leave, and does the data come with us?*

*Where from:* [exit cost](../foundations/requirements.md#exit-cost) — a first-class
criterion. It is how a small club stays safe while depending on free tiers.

---

## Working conventions

From the [repository README](../../README.md) and the
[build brief](../delivery/nn-build-brief.md), and they apply everywhere.

| | |
| --- | --- |
| **Every change by pull request.** Both volunteers have review access | Shared ownership is a property of the workflow, not a promise |
| **Documentation ships with the change it describes** | Not afterwards |
| **Markdown wraps at roughly 90 characters** | URLs excepted, because they cannot be broken |
| **Use the [glossary](../foundations/glossary.md)'s words exactly** | An *event* is one running of one race in one year; a *race* is the recurring thing; a *team* is the unit of entry even when it holds one runner. **Getting this wrong in a schema is expensive** |
| **Any step done by hand is written down** | What, why, by whom, and how to redo it |
| **No secrets in the repository. No personal data in logs** | A secret that was ever committed is compromised and must be **rotated**, not deleted |
| **Boring beats optimal** | Every unusual choice is a tax on somebody who has not been hired |

---

## Stop and ask

Triggers that end a build step and require a human. **Not to be resolved by inference** —
including by an agent.

- Any request to collect a **field beyond what is already specified**
- Any request to **take payment**, or to link to something that does
- Any **DNS change other than an additive record**
- A **factual claim about a race** not already supplied — date, price, distance, location
- Anything requiring the **Supabase service role key**
- Any change touching the **timing platform**
- Anything that would put a **credential in the repository**
- Discovering that a **free tier's terms differ** from what is recorded
- **Changing `[auth]` in `packages/db/supabase/config.toml`** — `site_url`, any redirect
  URL, or `enable_signup`. This block ships to the shared production project on every
  merge that touches a migration, and it is what a Supabase Auth magic link is built from.
  `enable_signup` in particular is currently **off** because whether the platform needs
  member-facing authentication at all is still undecided — turning it on is that decision

*Where from:* the [build brief](../delivery/nn-build-brief.md#stop-and-ask), generalised
beyond Nightingale Nightmare because none of these are specific to it.
