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
3. **If the change touches a migration, reset the database before trusting anything that
   hits Postgres — Playwright included.** A scoped `npx playwright test` (or
   `vitest run --project db`) does not rebuild the database the way `./dev check`/`./dev
   test` do; it runs against whatever schema the local Supabase container already has. And
   **that container is shared across every worktree on the machine** — `CLAUDE.md`'s own
   parallel-work note says so — so its state reflects whichever branch last reset it, not
   necessarily yours. A migration that is correct on disk but never applied to the running
   Postgres produces a failure that looks exactly like a real bug (a value never reaching a
   table, a trigger not firing) and is not one. `npm run db:reset --workspace=packages/db`
   from `platform/` (or `./dev up`) fixes it in under a minute. If a scoped run fails in a
   way that doesn't make sense against the code, check the live schema before debugging the
   code — `docker exec supabase_db_src-platform psql -U postgres -d postgres -c "..."`
   against `pg_get_functiondef`/`information_schema` answers "is this actually applied?"
   directly, faster than guessing.
4. **For Playwright, target the one spec file, on one engine, through `./dev e2e`.**
   `./dev e2e <path/to/spec.ts> --project=chromium` from the repository root builds the
   site and exports the three Supabase variables a scoped run needs — without which the
   fixtures throw `supabaseKey is required` from a file the failing test never mentions.
   Prefer this over a raw `npx playwright test`, which does neither.
   - **`nn-entry.spec.ts` and `nn-signup.spec.ts` need
     `--config=playwright.config.serial.ts`.** The base `playwright.config.ts` excludes
     both via `testIgnore` — they share state (`entries.events.entries_open_at`) that
     cannot run in parallel with the rest of the suite — so asking for either without the
     serial config gets **"no tests found", which reads as a pass**. This is a documented
     trap (`CLAUDE.md`), not an edge case: `./dev e2e nn-entry.spec.ts --project=chromium
     --config=playwright.config.serial.ts`.
   - Skip `mobile-safari` and `no-javascript` locally for iteration speed:
     - `no-javascript` already **skips** anything tagged `@requires-js` via
       `grepInvert: /@requires-js/` in `playwright.config.ts` — running it locally against a
       `@requires-js` spec proves nothing that project's own config doesn't already prove by
       construction.
     - `mobile-safari` (WebKit) is where this repository's own documented traps have actually
       been found (see `CLAUDE.md`'s "Traps that have already cost time") — it is real
       coverage, not redundant. Skip it locally for speed, but do not skip it forever: it runs
       in CI on the pull request, and a webkit-only failure there is not a false alarm.
   - **If the change touches layout, a stylesheet, or an assertion about where something is
     on the page, run `./dev e2e --linux` before pushing**, even though it is slower than a
     bare Chromium run. `CLAUDE.md` documents three separate sessions burned on a change
     that was green on a Mac and red on CI because of font-metric differences between
     platforms — `--linux` runs the browsers in CI's own container image and reproduces
     that gap locally, in seconds rather than a failed CI run and a guess.
5. **Reserve the full `./dev check` / `./dev test` for a final pass** — before opening the
   pull request, or when the change is broad enough that "which area" from step 1 is
   genuinely "several" (a schema migration, a shared module many routes import, a change to
   `config.toml`). Run it through the Haiku subagent this repository's `CLAUDE.md` already
   mandates for local tests and CI checks — that instruction and this one compose, they do
   not duplicate each other. It also settles step 3 for you: `./dev check`/`./dev test`
   rebuild the database from scratch every time.
6. **When something fails, isolate the cause before re-running.** Redirect output to a file
   and grep it for the actual failure rather than reading a truncated stream or re-running
   blind and hoping it clears up. A failure that repeats identically on a clean re-run is a
   real bug; a failure that changes shape between runs, or that is the same infrastructure
   error across many unrelated tests, is an environment problem — chase that instead of
   patching code that was never broken. A failing assertion whose own captured
   accessibility snapshot or DOM dump shows the thing it claims is missing is a matcher
   problem, not a feature problem — read what the tool actually captured before rewriting
   the code the test is supposedly checking.
7. **Never run two `./dev`-family or Docker-touching commands at once.** `./dev check`,
   `./dev test`, `./dev up` and `./dev e2e` all call `stop_workers`, which kills by
   command-line pattern machine-wide — documented in `CLAUDE.md` as "a second `./dev test`
   kills the first." Before starting one, check for anything already running against the
   same checkout (`pgrep -fl 'dev test\|dev check\|dev up\|dev e2e'`) rather than assuming a
   clear field.
8. **Push once the targeted check is green.** Do not chase a full local green as a
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

# Once green, check the browser behaviour the unit tests can't reach —
# ./dev e2e builds the site and exports the Supabase env the fixtures need
./dev e2e apps/main/tests/e2e/account.spec.ts --project=chromium
```

Both green is the actual signal to push. A `./dev check` had already run once, earlier,
across the whole repository, and found two real bugs in the new code (not in anything the
scoped runs would have needed to re-discover) — that is what the full run is *for*, and it
does not need repeating for every follow-up fix to the same two bugs.

**Two more things turned up on the way, worth keeping in mind as their own shape of
mistake:**

- A scoped Playwright run against the new page failed with the signed-up name missing from
  the profile — which read as a real bug in the new migration's trigger. It was step 3
  above: the shared local Postgres container had last been reset by a different worktree's
  branch, on a schema that predated this migration. `npm run db:reset` (30 seconds) and the
  same run passed. The migration itself had already been proven correct by the earlier
  `./dev check`, which rebuilds the database as a matter of course — the false alarm was
  entirely a byproduct of skipping that step for speed, and step 3 exists so it is
  recognised rather than chased into the code.
- A different failure's own captured accessibility snapshot showed the exact text the
  assertion claimed was missing, sitting right there in the DOM. That is a locator problem,
  not a page problem — `getByText` on a specific compound sentence resolved inconsistently
  for reasons that did not reproduce under inspection. The fix was the matcher
  (`site.spec.ts`'s own whitespace-squashed substring pattern), not the markup.
