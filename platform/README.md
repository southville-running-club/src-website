# The platform

The club's application code. One repository, npm workspaces, no Turborepo and no Nx —
[ADR-001](../docs/architecture/decisions/adr-001-one-monorepo.md).

The repository root is documentation; everything that builds lives here.
[ADR-006](../docs/architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md)
explains the layout and the name.

```
apps/
  main/       Astro 7, static, plus one Worker    → nn.southvillerunningclub.co.uk
  timing/     Next.js 16 + @opennextjs/cloudflare → timing.southvillerunningclub.co.uk
packages/
  db/         Supabase config, migrations, generated types
  shared/     Europe/London, the Supabase client, the stylesheet
```

**This is a skeleton.** Both applications serve a page that says so and one timestamp
fetched from Postgres. There is no sign-up form, no Stripe, and no timing application code.

## Getting started

**Docker must be running** — the local stack is a real Postgres, which is the only way
row-level security can be tested rather than mocked.

```bash
nvm use              # Node 22, per .nvmrc
npm install
npm run setup        # starts Supabase, resets, seeds, then astro dev
```

`npm run setup` prints the local Supabase credentials. Copy `.env.example` to `.env` and
paste in `API_URL` and the publishable key if you want them outside the Worker; the
Workers themselves already have them in `wrangler.jsonc`.

## Commands

|  |  |
| --- | --- |
| `npm run dev` | `astro dev` — the fast loop, `apps/main` |
| `npm run dev:worker` | `wrangler dev` — the real Workers runtime, `apps/main` |
| `npm run dev:timing` | `next dev` — `apps/timing` |
| `npm test` | Vitest: unit and database |
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

**`npm run test:e2e` is the heaviest thing here.** Two `workerd` servers and up to three
browser engines. Workers are capped at one locally on purpose. If you raise that, know
what you are asking the machine for.

**Never point `apps/timing`'s `build` script at `opennextjs-cloudflare build`.** OpenNext
builds Next.js by running one of this package's own npm scripts, so that makes it invoke
itself — it recursed 205 levels and took a laptop down. `build:next` exists solely to be
the thing OpenNext calls; the redundancy is the guard. See `apps/timing/open-next.config.ts`.

**An ambient `NODE_ENV=development` breaks the Next.js build.** It resolves React's
development build while the build expects production, and reports it as
`Cannot read properties of null (reading 'useContext')` while prerendering a page nobody
wrote. Every build script pins `NODE_ENV=production`.

**`wrangler dev` cannot test hostname routing.** With `routes` configured it rewrites
`request.url` to the custom domain and ignores the `Host` header, so every local request
looks like `nn.southvillerunningclub.co.uk`. Use `npm run test:worker`, which runs the same
runtime and preserves the URL.

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
