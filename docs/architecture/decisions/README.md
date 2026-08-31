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
| [**ADR-008**](adr-008-timing-port-before-the-race.md) | **The timing port lands before the race**, gated on a simulation with Vercel as the standing fallback. *Reverses the plan's earlier "after the race"* | 9 Aug 2026 |
| [**ADR-009**](adr-009-entries-in-apps-main.md) | **Race entries live in `apps/main`**, in a new `entries` schema — not in a repository of their own. *Retires the "separate entries application" working assumption* | 13 Aug 2026 |
| [**ADR-010**](adr-010-webhook-writes-paid.md) | **The Stripe webhook is the only thing that writes `paid`**, and the failure direction is inverted there | 13 Aug 2026 |
| [**ADR-011**](adr-011-a-race-and-its-runnings.md) | **A race and one running of it are different pages** — `/nn/` is evergreen, `/nn/2026/` is the year. *Extends ADR-007 by one path segment; its navigation section is superseded by ADR-012* | 15 Aug 2026 |
| [**ADR-012**](adr-012-one-navigation-bar.md) | **One navigation bar, and the year is never in it** — five controls, painted, and no longer sticky. *Supersedes ADR-011's navigation section; its sticky and five-control sections are superseded by ADR-014* | 15 Aug 2026 |
| [**ADR-013**](adr-013-the-admin-surface-and-who-may-read-it.md) | **Two credentials open the admin surface** — a Worker secret for authorisation, a key per person for identity. *Extends ADR-010's shared-key mechanism to the first read path that returns people* | 16 Aug 2026 |
| [**ADR-014**](adr-014-the-bar-stays-and-the-notice-is-in-it.md) | **The bar stays on screen, and the privacy notice is the sixth control in it** — the three defects that unstuck it are paid for rather than disputed. *Supersedes ADR-012's sticky and five-control sections* | 17 Aug 2026 |
| [**ADR-015**](adr-015-member-accounts-on-supabase-auth.md) | **Member accounts on Supabase Auth** — three roles, a new `identity` schema, and the JavaScript and `SameSite` costs that come with it. *Extends ADR-013's admin surface rather than replacing it. Its Roles row is superseded by [ADR-016](adr-016-registered-is-not-a-member.md) and [ADR-017](adr-017-permissions-are-what-code-checks.md).* | 24 Aug 2026 |
| [**ADR-016**](adr-016-registered-is-not-a-member.md) | **`registered` is the role an account gets, and `member` means membership** — the word the club needs for somebody who has joined and paid was being spent on "has signed up". *Supersedes ADR-015's Roles row; everything else it decided stands.* | 26 Aug 2026 |
| [**ADR-017**](adr-017-permissions-are-what-code-checks.md) | **A role is a bundle of permissions, and code checks the permission** — `identity.permissions`, `identity.role_permissions`, and one primitive in place of a role name at five call sites. *Supersedes what is left of ADR-015's Roles row, after ADR-016 renamed the role in it.* | 26 Aug 2026 |
| [**ADR-018**](adr-018-cancelling-an-entry.md) | **An nn-admin may cancel and refund one entry, and nothing else about it** — Stripe first, the record second, because that ordering is the one a retry repairs | 26 Aug 2026 |
| [**ADR-019**](adr-019-a-session-ends-on-its-own.md) | **A session ends on its own** — thirty minutes idle, twelve hours absolute, in place of the thirty days nobody chose. *Answers a question [ADR-015](adr-015-member-accounts-on-supabase-auth.md) built the session without asking.* | 28 Aug 2026 |
| [**ADR-020**](adr-020-race-category-and-gender-are-two-questions.md) | **Race category and gender are two questions** — a required closed list of three for the prize table, and optional free text beside it for the question itself, because a longer closed list is the same defect with more rows | 28 Aug 2026 |
| [**ADR-021**](adr-021-the-club-tells-people-by-outbox.md) | **The club tells a runner what happened, through an outbox rather than a send** — an `after update`/`after insert` trigger on `entry_purchases` writes the obligation to send in the same transaction as the thing it is about; a five-minute cron drains it through Resend. Delivery can be late; it cannot be lost | 28 Aug 2026 |
| [**ADR-028**](adr-028-a-place-can-be-given.md) | **A place can be given, not only sold** — a complimentary £0 entry assigned from `/admin/nn/` behind an eighth permission, because Stripe refuses a zero-total session and a 100% discount code cannot exist. *Amends [ADR-010](adr-010-webhook-writes-paid.md)'s "only the webhook writes `paid`", for the one case where there was no payment to be proof of.* **Renumbered from ADR-021, then from ADR-026, 31 Aug 2026** — see the note at the top of the record | 28 Aug 2026 |
| [**ADR-022**](adr-022-a-guide-rides-on-the-runners-entry.md) | **A guide rides on the runner's entry, and takes one of the 250** — a second entrant on one purchase rather than four reserved places, because what the club needed was for guides to be counted. The declaration is an Article 9 consent rather than a column | 28 Aug 2026 |
| [**ADR-023**](adr-023-no-england-athletics-numbers.md) | **The club holds no England Athletics number, and one column stops meaning two things** — how [decision 007](../../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers) is applied without breaking the deployed Worker: the columns are emptied and constrained rather than dropped, and `fees.affiliated` takes over the one fact `requires_ea_number` was carrying by accident | 29 Aug 2026 |
| [**ADR-024**](adr-024-one-entry-in-full.md) | **One entry in full, and the audit trail comes onto the surface** — a page per entry behind a row on `/admin/nn/`, with the payment, the people, every ask and the `admin_audit` rows that name it. *Reverses the position that the trail is deliberately off this surface; scoped to one entry, and the actor stays the pseudonym [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md) made it.* | 29 Aug 2026 |
| [**ADR-027**](adr-027-one-entry-point-for-a-running.md) | **One entry point for a running, not one page** — the race director asked for one page; what the repository supports is one entry *point*, `/nn/2026/`, with the year's other pages left live and reachable rather than folded in. *Narrows ADR-014 at one width on one page.* **Renumbered from ADR-024, 31 Aug 2026** — see the note at the top of the record | 29 Aug 2026 |
| [**ADR-025**](adr-025-the-club-asks-a-runner-for-a-phone-number.md) | **The club asks a runner for a phone number, and the race notice says what it holds** — the eighteenth entry field, required of a runner and asked of no guide, alongside the corrections that stop `/nn/privacy/` claiming two things nobody is asked for and omitting four it holds. *Ends that page being the committee's document published verbatim, and records that the club maintains it.* | 30 Aug 2026 |
| [**ADR-026**](adr-026-an-html-part-joins-the-outbox-emails.md) | **An HTML part joins the outbox emails, and the text stays authoritative** — one skin, four bodies, both computed from the same `OutboxMessage` so the two parts can differ only in presentation, never in which facts they state. *Reverses the plain-text-only decision recorded in `worker/email.ts`'s own comment, not in an ADR.* | 31 Aug 2026 |
| [**ADR-029**](adr-029-holding-a-place-takes-a-key.md) | **Holding a place takes a key, and a place that costs nothing is not held** — `create_pending_purchase()` is granted to `anon` and must stay granted, so a Worker secret is what separates a runner from a loop with the published key: without it, 249 anonymous holds took the whole 250-place field in half a second, for nothing, never reaching the Worker or the rate-limiting rule in front of it. *Closes [#178](https://github.com/southville-running-club/src-website/issues/178).* **Renumbered from ADR-026, 31 Aug 2026** | 31 Aug 2026 |
| [**ADR-030**](adr-030-an-entry-has-a-reference-somebody-can-read-out.md) | **An entry has a reference somebody can read out loud** — `NN2026-0042-01092026` in place of a 36-character purchase id, from a per-event number issued by a trigger and rendered by one shared function. *Takes the decision `worker/account.ts`'s own comment deferred; the purchase id stays on `/admin/nn/entry/`, where a payment is reconciled.* | 31 Aug 2026 |

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
| **Astro for the main website** | [platform options](../../solutions/platform-options.md#framework-which-is-a-separate-question-from-language) | Recommended everywhere, recorded nowhere. Already fixed for Nightingale Nightmare by the build brief |
| **The backup runbook**, including a tested restore | [database](../investigations/database.md#backups) | Nothing yet. **The largest gap in the data architecture** |
| **Document naming and the stable-URL contract** | — | [Plan](../../delivery/plan.md) step 57, and ideally before step 12 downloads them |
| **Who owns an `entry_requests` row** | — | [#148](https://github.com/southville-running-club/src-website/issues/148). The append-only ask history landed alongside ADR-024; nothing yet records who may act on a request or how |

**Does the website need member-facing authentication?** Answered **yes**, 24 August 2026 —
[ADR-015](adr-015-member-accounts-on-supabase-auth.md) and [decision 005](../../decisions/decision-log.md#005--give-the-platform-member-accounts-on-supabase-auth).
