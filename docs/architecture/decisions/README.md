# Architecture decision records

Technical decisions the volunteers take themselves.

| | | Accepted |
| --- | --- | --- |
| [**ADR-001**](adr-001-one-monorepo.md) | **One monorepo, npm workspaces** | 8 Aug 2026 |
| [**ADR-002**](adr-002-schema-layout.md) | **Four schemas in one project**, and NN sign-ups land in `intake` | 8 Aug 2026 |
| [**ADR-003**](adr-003-local-development-and-pipeline.md) | **Local development on `localhost` with mock data**, acceptance tests in the pipeline | 8 Aug 2026 |
| [**ADR-004**](adr-004-no-staging-environment.md) | **No staging environment** | 8 Aug 2026 |
| [**ADR-005**](adr-005-manual-with-a-reviewable-artefact.md) | **DNS stays manual**, with a committed zone file as the reviewable artefact | 8 Aug 2026 |
| [**ADR-006**](adr-006-apps-main-and-hostnames-as-code.md) | **`apps/main` serves every club hostname**, declared in `wrangler.jsonc`; the npm project lives in `platform/`. *Its hostname decision is superseded by ADR-007* | 8 Aug 2026 |
| [**ADR-007**](adr-007-one-hostname-paths-not-subdomains.md) | **One hostname, told apart by path** — `new.<apex>`, `/nn`, `/timing`. Two Workers, one origin | 9 Aug 2026 |

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

Still [open](https://github.com/southville-running-club/src-website/issues/1). None should
be recorded until it is actually taken.

| | Investigation | Blocks |
| --- | --- | --- |
| **Declarative schemas or imperative migrations** | [database](../investigations/database.md#declarative-schemas-are-probably-the-better-tool) | Not blocking, but cheaper to choose before there are migrations to convert |
| **Workers or Pages for the main website** | [deployment](../investigations/deployment.md#pages-or-workers) | The website build. Depends on the DNS move landing first, so not urgent — but it decides whether the main build starts on the supported path |
| **Astro for the main website** | [platform options](../../solutions/platform-options.md#framework-which-is-a-separate-question-from-language) | Recommended everywhere, recorded nowhere. Already fixed for Nightingale Nightmare by the build brief |
| **The backup runbook**, including a tested restore | [database](../investigations/database.md#backups) | Nothing yet. **The largest gap in the data architecture** |
| **Does the website need member-facing authentication?** | — | Answering *no* removes a large amount of build **and** a large amount of personal data |
| **Document naming and the stable-URL contract** | — | [Plan](../../delivery/plan.md) step 57, and ideally before step 12 downloads them |
