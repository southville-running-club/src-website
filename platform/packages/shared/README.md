# `packages/shared` — the code every app imports rather than reimplements

Zod schemas, formatting helpers and CSS the club's apps share, so `apps/main` and
`apps/timing` cannot quietly disagree about what a date looks like or what a valid entry is.
[ADR-001](../../../docs/architecture/decisions/adr-001-one-monorepo.md) is why this is an
import rather than a published package.

**This file orients rather than catalogues.** With 24 source files and growing, restating
what each one does here is exactly the kind of duplication the rest of this repository's
documentation has been found to drift from — read a file's own header comment and its test
for what it actually does today. What follows is the handful of files that carry a rule
strong enough to be worth knowing about before you start, because getting one of these wrong
is expensive in a way a normal bug is not.

| File | The rule it enforces | Why it matters |
| --- | --- | --- |
| `london-time.ts` | The **only** permitted path from a stored UTC timestamp to displayed `Europe/London` time | ESLint bans bare `toLocale*String` repository-wide. Nightingale Nightmare is raced the weekend after the clocks change — an hour of drift is a real foot-gun here, not a theoretical one |
| `nn-entry.ts` | The committee-settled list of what a race entry may collect | Adding a field here is a committee decision, not a build one — see `CLAUDE.md`'s stop-and-ask list at the repository root |
| `medical-retention.ts` | The wording for the medical-note retention period | Tied to the enforced deletion interval by `entries-retention.test.ts` in `packages/db` — the two cannot drift apart without the test catching it |
| `age-category.ts` | Which prize band a runner's age falls into | The one place this logic lives; the admin surface's category counts and the start list both read it rather than re-deriving |
| `admin.ts` | `missingFunctionCause()`, among other admin-surface types | Names the "the site is ahead of its database" failure mode CLAUDE.md documents under migration-ordering traps |
| `contrast.ts` | Colour-pair contrast calculation | What `admin-contrast.test.ts` and `nn-contrast.test.ts` actually call to assert a wash meets its bar — read alongside `styles/tokens.css` |

## `styles/`

`tokens.css` is this repository's canonical design tokens — not the imported
`race-timing-brand-guidelines.md` under `docs/foundations/`, which is a source document kept
for its reasoning and explicitly says not to edit tokens there. `nn-theme.css` is
Nightingale Nightmare's own campaign design and is deliberately never imported into the club
brand or the admin surface (`nn-admin.css`); `account.css` and `base.css` are shared.

## Where the actual behaviour is asserted

Read `packages/shared/tests/unit/` for current behaviour, not this README — most source
files have a matching test file there, and `brand.test.ts` / `admin-contrast.test.ts` /
`nn-contrast.test.ts` are what actually enforce the contrast rules above.
