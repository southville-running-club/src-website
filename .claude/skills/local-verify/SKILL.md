---
name: local-verify
description: "Fast, targeted local verification of a change before opening a pull request — run only the tests the change actually touches, not the whole suite. Use whenever you've edited code in this repository and want confidence before pushing."
---

# Local verify

**The full suite is not the fast path to confidence — it is the fallback.** `./dev check`
and `./dev test` exist to be exhaustive, and CI runs them exhaustively on every pull request
anyway. Re-running them end to end after every small edit answers a question nobody asked
("did anything, anywhere, break?") slowly, when the real question — "did *this* change
work?" — has a much faster answer. This skill is that faster answer.

**The goal is confidence, not certainty.** Push once a targeted check is green. CI's full
multi-engine, multi-suite run is the exhaustive gate; a local pre-push pass exists to catch
the obvious break before a human reviewer sees it, not to duplicate CI.

**This is a scoping rule, not an exemption from the subagent rule.** `CLAUDE.md`'s own "Run
local tests and CI/pipeline checks through a Haiku subagent" applies to every command below,
scoped or full — a scoped run is smaller, not exempt. What follows narrows *what* to run;
it never changes *where*.

## The rule

1. **Identify what actually changed** — which package, which route, which schema. Most
   edits touch one area; verify that area, not the repository.
2. **Prefer a scoped, no-Docker check first.** `npx vitest run --project unit <path/to/file>`
   from `platform/` runs a single test file in seconds, no Postgres, no Docker. Use this to
   iterate on a fix.
3. **For Playwright, target the one spec file, on one engine.** Build once —
   `npm run build && npm run build:worker` from `platform/` — then
   `npx playwright test <path/to/spec.ts> --project=chromium`. Skip `mobile-safari` and
   `no-javascript` locally:
   - `no-javascript` already **skips** anything tagged `@requires-js` via
     `grepInvert: /@requires-js/` in `playwright.config.ts` — running it locally against a
     `@requires-js` spec proves nothing that project's own config doesn't already prove by
     construction.
   - `mobile-safari` (WebKit) is where this repository's own documented traps have actually
     been found (see `CLAUDE.md`'s "Traps that have already cost time") — it is real
     coverage, not redundant. Skip it locally for speed, but do not skip it forever: it runs
     in CI on the pull request, and a webkit-only failure there is not a false alarm.
4. **Reserve the full `./dev check` / `./dev test` for a final pass** — before opening the
   pull request, or when the change is broad enough that "which area" from step 1 is
   genuinely "several" (a schema migration, a shared module many routes import, a change to
   `config.toml`). Run it through the Haiku subagent this repository's `CLAUDE.md` already
   mandates for local tests and CI checks — that instruction and this one compose, they do
   not duplicate each other.
5. **When something fails, isolate the cause before re-running.** Redirect output to a file
   and grep it for the actual failure rather than reading a truncated stream or re-running
   blind and hoping it clears up. A failure that repeats identically on a clean re-run is a
   real bug; a failure that changes shape between runs, or that is the same infrastructure
   error across many unrelated tests, is an environment problem — chase that instead of
   patching code that was never broken.
6. **Never run two `./dev`-family or Docker-touching commands at once.** `./dev check`,
   `./dev test` and `./dev up` all call `stop_workers`, which kills by command-line pattern
   machine-wide — documented in `CLAUDE.md` as "a second `./dev test` kills the first."
   Before starting one, check for anything already running against the same checkout
   (`ListAgents`, or `pgrep -fl 'dev test\|dev check\|dev up'`) rather than assuming a clear
   field.
7. **Push once the targeted check is green.** Do not chase a full local green as a
   precondition for every push — that is CI's job, and it will do it more thoroughly than a
   pre-push run can afford to.

## Worked example

Issue #61 added `/account/details/` — one Worker route, one shared Zod schema, one new
Playwright spec file. The wrong way to verify it is `./dev test` end to end: ~5 minutes,
three browser engines, every other spec file in the repository, and a result that says
nothing more about the actual change than a scoped run would. The fast path:

```bash
# Iterate on the schema/handler fix — seconds, no Docker
cd platform && npx vitest run --project unit apps/main/tests/unit/account.test.ts

# Once green, check the browser behaviour the unit tests can't reach
npm run build && npm run build:worker
npx playwright test apps/main/tests/e2e/account.spec.ts --project=chromium
```

Both green is the actual signal to push. A `./dev check` had already run once, earlier,
across the whole repository, and found two real bugs in the new code (not in anything the
scoped runs would have needed to re-discover) — that is what the full run is *for*, and it
does not need repeating for every follow-up fix to the same two bugs.
