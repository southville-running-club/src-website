# Architecture decision records

Technical decisions the volunteers take themselves. **Nothing recorded here yet.**

---

## Two decision homes, and which one a choice belongs in

**This is the important part of this page**, because two decision logs is a way to lose
decisions. There is one rule.

| | [`docs/decisions/decision-log.md`](../../decisions/decision-log.md) | **Here** |
| --- | --- | --- |
| **For** | Decisions the **club** takes | Decisions the **build** takes |
| **Typically** | A vendor, a recurring cost, where personal data lives, anything the committee ratifies | Schema shape, repository layout, test strategy, library choice |
| **Ratified by** | The committee, against the [governance gates](../../foundations/requirements.md#legal-and-governance) | The two volunteers, by pull request |
| **Reversing it costs** | Money, or a migration | An afternoon to a fortnight |
| **Numbering** | `001`, `002`, … | `ADR-001`, `ADR-002`, … |

The existing log [already states its own
bar](../../decisions/decision-log.md#what-gets-a-record): a choice needs a record if it
picks a vendor or infrastructure primitive, changes where personal data lives, would be
expensive to reverse, or commits the club to a recurring cost — and *"if reversing it costs
an afternoon, just make it."*

**This folder is the gap between those two sentences.** Choices too consequential to make
silently, but not the committee's business.

### Worked examples

| | Goes in | Why |
| --- | --- | --- |
| "Cloudflare serves the site" | **Decision log** | Vendor, recurring cost, exit cost |
| "One Supabase project, four schemas" | **Decision log** | Where personal data lives |
| "`intake` is separate from `club`" | **Here** | Schema shape. Real consequences, no money, no vendor |
| "Monorepo with npm workspaces" | **Here** | Layout. Reversible in an afternoon, but not silently |
| "Declarative schemas over imperative migrations" | **Here** | Tooling, with a discipline cost worth writing down |
| "Zod for validation" | **Nowhere** — it is [already a principle](../principles.md#standing-technical-choices) | Settled, and not worth a record |
| "Buy a throwaway domain for DNS rehearsal" | **Decision log** | ~£10/yr recurring, however small |

**When in doubt, the decision log.** A record in the more visible place is a small cost; a
committee-relevant decision buried in a technical folder is not.

---

## The shape of a record

The [same seven sections as the decision
log](../../decisions/decision-log.md#the-shape-of-a-record), deliberately — one habit, not
two. Two of them are what make a record worth writing:

**Exit cost is mandatory.** *"A decision whose exit cost nobody can state is a decision
nobody can safely review."*

**"Revisit when", not "revisit if".** A condition somebody can notice, not a hope. *"When
the free tier stops permitting payments"* is a trigger; *"if it becomes a problem"* is not.

For an ADR, two sections usually compress:

| Section | For an ADR |
| --- | --- |
| **Requirement** | Which [capability](../../foundations/requirements.md#capabilities) or [principle](../principles.md) this serves |
| **Context** | The facts that forced a choice |
| **Options** | Usually a link into [investigations](../investigations/), not a fresh comparison |
| **Decision** | Present tense |
| **Consequences** | Including costs knowingly accepted |
| **Exit cost** | What undoing it takes |
| **Revisit when** | The condition |

**Never edit an accepted record to change its answer.** Write a new one that supersedes it,
naming what it replaces — *"the history of a choice that turned out badly is worth more than
a tidy file."*

---

## What is waiting to be recorded here

Each of these is a decision this folder exists for. All are
[open](https://github.com/southville-running-club/src-website/issues/1); none should be
recorded until it is actually taken.

| | Investigation | Blocks |
| --- | --- | --- |
| **Repository shape** — one of five candidates | [repositories](../investigations/repositories.md) | **The Nightingale Nightmare scaffold** ([plan](../../delivery/plan.md) step 17) |
| **Schema layout** — `public` / `private` / `club` / `intake` | [database](../investigations/database.md#schema-design) | Any table creation |
| **Where Nightingale Nightmare v1 rows land** | [database](../investigations/database.md#nightingale-nightmare-is-an-event-not-an-application) | The sign-up form persisting anything |
| **Who owns migrations**, and whether schema is scoped or centralised | [database](../investigations/database.md#migrations) | The first migration against the shared project |
| **Declarative schemas or imperative migrations** | [database](../investigations/database.md#declarative-schemas-are-probably-the-better-tool) | Not blocking, but cheaper to choose before there are migrations |
| **Workers or Pages for the main website** | [deployment](../investigations/deployment.md#pages-or-workers) | The website build. Time-sensitive — it depends on the DNS move landing first |
| **Astro for the main website** | [platform options](../../solutions/platform-options.md#framework-which-is-a-separate-question-from-language) | Recommended everywhere, recorded nowhere |
| **The local stack and test strategy** | [local development](../investigations/local-development.md) | Nothing, but it sets the shape of every pull request |
| **The backup runbook** | [database](../investigations/database.md#backups) | Nothing yet. **The largest gap in the data architecture** |
