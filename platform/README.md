# The platform

The club's application code. One repository, npm workspaces, no Turborepo and no Nx —
[ADR-001](../docs/architecture/decisions/adr-001-one-monorepo.md).

The repository root is documentation; everything that builds lives here.
[ADR-006](../docs/architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md)
explains the layout and the name.

```
apps/
  main/       Astro 7, static, plus one Worker    → new.<apex>/  and  /nn
  timing/     Next.js 16 + @opennextjs/cloudflare → new.<apex>/timing
packages/
  db/         Supabase config, migrations, generated types
  shared/     Europe/London, the Supabase client, validation, the stylesheet
```

`apps/main` now carries **the Nightingale Nightmare pages, an interest form and an entry
form** — `/nn/` shows one or the other according to `entries.events`, decided per request.
There is **no Stripe and no timing application code**: the entry form validates and stops.
[ADR-009](../docs/architecture/decisions/adr-009-entries-in-apps-main.md).

## Getting started

**Docker must be running** — the local stack is a real Postgres, which is the only way
row-level security can be tested rather than mocked.

**From the repository root, one command does everything** — starts Docker if it is not
running, brings up the database, seeds it, builds both applications, starts both Workers
and opens the site:

```bash
./dev up
```

Nothing to configure: the local Supabase values are already in each app's
`wrangler.jsonc`, and they are the same on every machine.

The npm commands below all work too, from **this** directory — `npm` at the repository
root has no `package.json` to find.

## The local site

`npm run dev:all` gives you **the public shape, not an approximation of it** — one origin
serving the whole site, with the paths identical to production:

| Local | Production | Serves | From |
| --- | --- | --- | --- |
| http://localhost:8787/ | `new.<apex>/` | The club website | `apps/main` |
| http://localhost:8787/nn/ | `new.<apex>/nn` | **Nightingale Nightmare** | `apps/main` |
| http://localhost:8787/timing | `new.<apex>/timing` | **Race timing** | `apps/timing` |

At the Squarespace cutover the hostname changes and **nothing else does** — `<apex>/nn` and
`<apex>/timing` are the same paths on a different name. The website can be built up around
the race and the timing platform without either of them moving.
[ADR-007](../docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).

**`/timing` is a different Worker**, on :8788. In production Cloudflare dispatches it at
the edge, because a route carrying a path beats a Custom Domain on the same hostname.
Locally `apps/main` forwards it, which is a stand-in for that router rather than a
difference in behaviour — so **you only ever need :8787**.

**Both apps read the same database.** Locally that is the Supabase stack in Docker; in
production it is one project, asserted by a test rather than trusted to two dashboards.

Check it end to end at any time — the same seven assertions CI runs against production:

```bash
npm run smoke -- --local
```

### The other dev server

`npm run dev` is `astro dev` on **:4321** — instant reload, but **no Worker runs**, so the
database timestamp stays at its placeholder and hostname routing does not apply. Good for
content and CSS, misleading for anything else.

## Commands

|  |  |
| --- | --- |
| `npm run dev:all` | **The whole site on :8787.** Starts both Workers |
| `npm run dev` | `astro dev` — the fast loop, `apps/main`, :4321 |
| `npm run dev:worker` | `wrangler dev` — `apps/main` alone, :8787 |
| `npm run dev:timing` | `next dev` — `apps/timing` alone, :8788/timing |
| `npm run smoke` | The seven checks against **production**. `-- --local` for localhost |
| `npm test` | Vitest: unit and database |
| `npm run entries:open` / `entries:close` | Move the local NN entry window, so `/nn/` shows the entry form or the interest one. `--workspace=packages/db` |
| `npm run test:worker` | Inside the Workers runtime, via Miniflare. Needs a build first |
| `npm run test:e2e` | Playwright + axe. **Builds first, then starts both servers** |
| `npm run build` | Every workspace |
| `npm run build:worker` | The deployable OpenNext bundle for `apps/timing` |
| `npm run lint` | ESLint and Prettier |
| `npm run typecheck` | `strict: true`, every workspace |
| `npm run db:start` / `db:stop` / `db:reset` | The local Supabase stack |
| `npm run db:types` | Regenerate `packages/db/src/database.types.ts` |

## Things that will bite you

Each of these cost real time on 8 August 2026 and none is obvious from the outside.

**`npm run test:e2e` is fine, and the guards are why.** Measured on 13 August 2026: two
builds then **274 tests in around 90 seconds**, one Playwright worker, nothing left running.
It took a laptop down once — that was the OpenNext build recursion below, not the suite
itself.

**Playwright starts a third server, and it is a fake Stripe.** `scripts/stripe-stub.mjs` on
:8789 answers `POST /v1/checkout/sessions` with a canned session and nothing else, so the
entry form runs end to end with **no Stripe credentials anywhere**. The suite asserts *where*
the Worker redirects and never follows it: Stripe's hosted page is a third party's, and a
test that types into it breaks the week they redesign it. `./dev up` starts the same process
alongside the two Workers.

**`workers` is 1 everywhere, including CI, and that is now load-bearing.** It was a cap on
process count; it is now also isolation. `nn-entry.spec.ts` moves
`entries.events.entries_open_at` to see the entry form and `nn-signup.spec.ts` needs it left
alone — Playwright parallelises across *files*, so with two workers those two interleave and
each occasionally sees the other's state. A few seconds of CI against a class of intermittent
that gets rerun rather than read.

**`npm run test:worker` is two runs, not one.** The default config against the seeded closed
window, and `vitest.worker.entries-open.config.ts` against an open one. `pg` cannot run
inside `workerd`, so the window is moved from Vitest's `globalSetup` in the Node process —
and `serves.test.ts` asserts `/nn/` quotes no price, which is true exactly while entries are
shut.

**Never point `apps/timing`'s `build` script at `opennextjs-cloudflare build`.** OpenNext
builds Next.js by running one of this package's own npm scripts, so that makes it invoke
itself — it recursed 205 levels and took a laptop down. `build:next` exists solely to be
the thing OpenNext calls; the redundancy is the guard. See `apps/timing/open-next.config.ts`.

**An ambient `NODE_ENV=development` breaks the Next.js build.** It resolves React's
development build while the build expects production, and reports it as
`Cannot read properties of null (reading 'useContext')` while prerendering a page nobody
wrote. Every build script pins `NODE_ENV=production`.

**Keep `routes` under `env.production`, not at the top level.** It is why a plain
`wrangler deploy` is harmless — no hostname outside production — and why `wrangler dev`
does not rewrite `request.url` to the live domain.

**`TIMING_ORIGIN` must never appear in `env.production`.** Its absence is what makes
`/timing` Cloudflare's job at the edge rather than an extra proxy hop through `apps/main`.

**Two copies of React or Next in the workspace break the build** in ways that read as
application bugs. After changing a version, `npm dedupe` and check there is one copy.

## Conventions

Every change by pull request; documentation ships with the change it describes; markdown
wraps at roughly 90 characters.

Use [the glossary](../docs/foundations/glossary.md)'s words exactly — an _event_ is one
running of one race in one year, a _race_ is the recurring thing, and a _team_ is the unit
of entry even when it holds one runner. **Getting this wrong in a schema is expensive.**

Before writing code, read
[the architectural principles](../docs/architecture/principles.md). It is short, and it is
the part that is not under discussion — including
[the triggers that mean stop and ask a human](../docs/architecture/principles.md#stop-and-ask).
