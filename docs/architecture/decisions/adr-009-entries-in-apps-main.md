# ADR-009 — Race entries live in `apps/main`, not in a repository of their own

**Accepted**, 13 August 2026. Completes
[ADR-001](adr-001-one-monorepo.md) and retires the *separate entries application* working
assumption described below.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [people](../../foundations/requirements.md#people) |
| **Supersedes** | No ADR. See "what this actually supersedes" |

## Context

Every page and comment written before this one refers to **"the entries application"** as
something separate from this site — a build that takes an entry and a payment, living in its
own repository (`src-race-entries`), against which this site was careful not to quote a price
or an opening time it did not own.

**That plan is abandoned.** Entries are built here, in `apps/main`, alongside the interest
form they replace when the window opens.

### What this actually supersedes

**No architecture decision record ever chose a separate repository**, and it is worth being
exact about that rather than tidy. [ADR-001](adr-001-one-monorepo.md) chose *one monorepo*
on 8 August 2026 and has never been reversed; [ADR-006](adr-006-apps-main-and-hostnames-as-code.md)
put every club surface inside `apps/main` rather than one application per race.

What existed was a **working assumption**, never written down as a decision but threaded
through the repository in a dozen places — `CLAUDE.md`, `apps/main/README.md`, the head of
`nn-theme.css`, `docs/design/README.md`, four page comments and three tests. It was load-
bearing in one specific way, and that way was correct: it is why `/nn/` still quotes no entry
price and no opening time. **This record names the assumption so it can be retired
deliberately, rather than eroded one comment at a time.**

## Decision

**Race entries are built in `apps/main`, in this repository.**

| | |
| --- | --- |
| **Code** | `apps/main` — the same Astro build, the same Worker, the same `/nn/` page |
| **Data** | A new `entries` schema in the same Supabase project, alongside `club` and `intake` — the shape [ADR-002](adr-002-schema-layout.md) established |
| **The switch** | `/nn/` shows the entry form when `entries.events` says entries are open, and the interest form otherwise. Read per request, so opening entries is a row edit and not a deploy |

### Why not a third repository

**Two volunteers with day jobs.** That is the constraint every choice here answers to, and
[ADR-001](adr-001-one-monorepo.md) already worked the argument through for the first two
applications. Nothing about entries changes it:

| | |
| --- | --- |
| **CI would be duplicated** | The workflow, the local Supabase stack, the migration-scope guard, the type-drift gate, the axe configuration. Three copies of a pipeline maintained by two people is one copy that quietly falls behind |
| **The shared code would have to travel** | The entry form validates with the same Zod module the Worker does and derives categories with the same date arithmetic the timing platform will. Across repositories that travels as a published package, a submodule, or — realistically — a copy that drifts |
| **Review load would triple** | Every change by pull request, both volunteers reviewing. A third repository is a third place to have that habit |
| **The hostname is already solved** | [ADR-007](adr-007-one-hostname-paths-not-subdomains.md) put the whole club on one hostname told apart by path, and this monorepo already runs two Workers behind it. A third repository would be solving a problem that was solved on 9 August |
| **The database is one project** | Entries join events and, later, results. A separate repository owning a schema in a database it does not migrate is the ownership question ADR-002 exists to avoid |

### Why a new schema rather than more of `intake`

`intake` is *what a stranger may post into*: anonymous insert, nothing readable, nothing
worth much if a policy is wrong. An entry is neither of those things. It carries a payment
reference, a date of birth, an emergency contact and — under its own separate consent —
free-text medical information, which is **special category data under UK GDPR Article 9**.

The schema boundary is the blast radius. An anonymous-insert policy that is wrong on
`intake` is a nuisance; the same policy wrong on `entries` is a personal-data incident and a
financial one at the same time. `entries` gets its own schema for the reason `club` has one.

## Consequences

**Good**

- One `npm install`, one CI run, one review habit, one set of conventions.
- The Zod schema, the timezone module and the age-category derivation are **imports**, not
  published packages. The form and the Worker cannot disagree about what a valid entry is.
- The interest form and the entry form are one page with one privacy notice, and the switch
  between them is a row rather than a release.
- The migration-scope guard, the type-drift gate and the accessibility suite all cover
  entries from their first commit, because they already existed.

**Costs, and they are real**

- **`apps/main` now carries two forms on one page.** Both are in the DOM on every request
  and the Worker reveals one. That cost the acceptance suite its unscoped locators the day
  it landed — `getByLabel('Email address')` stopped being unambiguous — and both spec files
  now say which form they mean.
- **The acceptance suite runs a single worker.** Two spec files own the same event row, and
  Playwright parallelises across files. A few seconds of CI, against a class of intermittent
  that gets rerun rather than read.
- **The page bundle grew.** The entry form's progressive enhancement validates with the
  shared Zod schema rather than a second copy of the rules, which puts Zod in the page —
  measured in [`apps/main/README.md`](../../../platform/apps/main/README.md). Requested
  deliberately, paid knowingly, and the figure is written down so it can be revisited.
- **A fourth fee code would be a migration *and* a deploy.** The three codes are a check
  constraint in the schema and three cards in the markup; the Worker fills in whichever the
  event offers. Prices are data, the set of codes is not.

**Neutral**

- `src-race-entries` was never created, so there is nothing to migrate or archive.
- The assumption's *conservatism* survives it. `/nn/` still quotes no price and no opening
  time when entries are shut — not because they belong to another application, but because
  they are `null` in `entries.events` and no committee has confirmed them.

## What changed elsewhere in this pull request

The assumption was in prose, so retiring it is prose. Each of these said entries were
somebody else's:

| | |
| --- | --- |
| `CLAUDE.md` | "Entries are a separate application" |
| `platform/apps/main/README.md` | The `price`, `entriesOpen` row in the race-facts table |
| `packages/shared/styles/nn-theme.css` | Two notes on the mockup and on the primary button |
| `docs/delivery/nn-build-brief.md` | Payment as a stop-and-ask; the two-variable environment |

`docs/design/README.md` is left as it stands: it describes what the *mockup* is, and the
mockup really was drawn as a separate application.
