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
npm run db:start     # Postgres, auth, storage — Docker
npm run dev:all      # both front doors, in the real Workers runtime
```

Nothing to configure: the local Supabase values are already in each app's
`wrangler.jsonc`, and they are the same on every machine.

## The local site

`npm run dev:all` gives you **the public shape, not an approximation of it**. Browsers
resolve `*.localhost` to 127.0.0.1 with no `/etc/hosts` entry, so the hostnames work as
they do in production.

| Local | Production | Serves |
| --- | --- | --- |
| http://localhost:8787/ | the apex, eventually | The platform index |
| **http://nn.localhost:8787/** | `nn.southvillerunningclub.co.uk` | **Nightingale Nightmare** |
| http://localhost:8787/nn/ | `<apex>/nn/` | The same page, by path |
| **http://localhost:3000/** | `timing.southvillerunningclub.co.uk` | **Race timing** |

Two ports rather than one, because a Worker is a Worker: each is its own runtime, exactly
as each is its own Worker in production. Routing between them is Cloudflare's job there and
the hostname's job here — putting a proxy in front locally would be a fiction, and this
repository has already been bitten twice by local tools that lie.

**Both apps read the same database.** Locally that is the Supabase stack in Docker; in
production it is one project, asserted by a test rather than trusted to two dashboards.

### The two other dev servers

`npm run dev` is `astro dev` on **:4321** — instant reload, but **no Worker runs**, so the
database timestamp stays at its placeholder and hostname routing does not apply. Good for
content and CSS, misleading for anything else.

`npm run preview --workspace=apps/timing` is **:8789** — the timing app as it actually
deploys, through the OpenNext bundle. Needs `npm run build:worker` first.

## Commands

|  |  |
| --- | --- |
| `npm run dev:all` | **Both front doors**, real Workers runtime — :8787 and :3000 |
| `npm run dev` | `astro dev` — the fast loop, `apps/main`, :4321 |
| `npm run dev:worker` | `wrangler dev` — `apps/main` alone, :8787 |
| `npm run dev:timing` | `next dev` — `apps/timing` alone, :3000 |
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

**Keep `routes` under `env.production`, not at the top level.** With routes at the top
level, `wrangler dev` rewrites `request.url` to the custom domain and ignores the `Host`
header — every local request looks like the live hostname, and `nn.localhost` stops
working. That is also why a plain `wrangler deploy` is harmless: no routes outside
production.

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
