# `apps/timing` — the race-timing platform on Cloudflare

Next.js 16 under `@opennextjs/cloudflare`, deployed as a Worker serving
**`new.southvillerunningclub.co.uk/timing`**.

## A path, not a subdomain — and what that costs

`new.<apex>` belongs to `apps/main` as a Custom Domain. This app attaches to the *same*
hostname with a **route carrying a path**, `new.<apex>/timing/*`. Cloudflare matches
most-specific-first and a path route beats a Custom Domain, so `/timing/*` is dispatched
here at the edge and never reaches `apps/main`.
[ADR-007](../../../docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md)
records why, and what it costs.

Two consequences the port has to carry:

**`basePath: '/timing'`** in `next.config.ts`. The application's routes stay written as
root paths (`/live/…`, `/admin/…`, `/marshal/…`) and Next prefixes them at build time. One
setting, but it touches every link and asset the app serves — the smoke test checks a
stylesheet resolves under `/timing/_next/`, because without it the app arrives unstyled and
half-broken in a way that looks like a CSS bug.

**The service worker scope becomes `/timing/`.** That is the offline capture queue — the
single most important thing in this application — and anyone with the app already installed
holds a registration for the old scope. **Rehearse this during the port; do not assume it.**

**This is the deployment half of [Phase
4](../../../docs/delivery/phases.md#phase-4--the-timing-app-on-cloudflare), done early and
on purpose — and it is done.** The phases document asked for exactly this:

> Stand up a hello-world Worker on the club hostname early — proving Workers Builds, the
> route and Supabase connectivity with a page that has nothing in it. Then the port only
> has to prove the application half, and every failure after that is application code.

**No timing application code lives here yet**, and none should until the port happens
deliberately. Per
[ADR-008](../../../docs/architecture/decisions/adr-008-timing-port-before-the-race.md), the
port lands before Nightingale Nightmare 2026, gated on a full manual race simulation — the
real application, `src-race-timing`, still runs from Vercel and stays the fallback until
that simulation passes.

## What it proves

One page, server-rendered on every request, showing a timestamp read from Postgres. That
establishes: the OpenNext build produces a working Worker, the custom domain resolves with
a certificate, Node compatibility is sufficient for `@supabase/supabase-js`, and the Worker
can reach the database. Every later failure in the port is then application code.

## The three build scripts, and why they must not be merged

|  |  |
| --- | --- |
| `build` | `next build` — what CI and the workspace root run |
| `build:next` | `next build` — **what OpenNext runs.** Never anything else |
| `build:worker` | `opennextjs-cloudflare build` — the deployable bundle |

`opennextjs-cloudflare build` produces the Next.js output by running one of this package's
own npm scripts. Point that script back at `opennextjs-cloudflare build` and it invokes
itself: on 8 August 2026 it **recursed 205 levels deep and took the laptop down.**

`open-next.config.ts` sets `buildCommand` to `npm run build:next` so the loop cannot form
however `build` is later edited. The duplication is the guard, not an oversight.

Relatedly: `initOpenNextCloudflareForDev()` in `next.config.ts` is guarded to
`NODE_ENV === 'development'`, because it spawns a workerd instance as a side effect of
loading the config — and `next build` loads the config again in every static-generation
worker.

## Commands

```bash
npm run dev            # next dev on :8788
npm run build:worker   # the OpenNext bundle
npm run preview        # the real Workers runtime on :8788, against an existing bundle
```

Locally it answers on **http://localhost:8788/timing** directly, and on
**http://localhost:8787/timing** through `apps/main`, which forwards `/timing/*` as a
stand-in for Cloudflare's edge router. Use :8787 — it is the shape the public gets.

`preview` deliberately does **not** build. `npm run test:e2e` at the workspace root builds
first, so the Playwright servers start against a build that already exists.

## Known before the port begins

From the [architecture review](../../../docs/reference/timing-app-review.md), and none of
it is discovered by this skeleton — it is what the skeleton exists to make cheap to find
out about.

- **The live leaderboard is a rebuild, not a port.** Supabase Realtime caps at 200
  concurrent; Durable Objects with hibernatable WebSockets are close to free on the free
  plan.
- **Solo-race gaps.** The leaderboard derivation is relay-shaped, and age-band categories
  do not exist yet. Nightingale Nightmare needs them.
- **Bundle size and CPU limits are unmeasured** for this application — 3 MB compressed and
  10 ms CPU on the free plan.
- **Three things the port must not break:** the IndexedDB offline queue and its
  idempotent-upsert contract, the TypeScript/SQL lockstep on bib resolution, and
  `Europe/London` pinning.

## Manual steps

**No DNS record is created for this Worker**, and none is needed — it attaches by route to
a hostname `apps/main`'s Custom Domain already created. Full procedure in the
[Cloudflare runbook](../../../docs/delivery/runbooks/cloudflare-setup.md).

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Worker and connect Workers Builds_ | No deploy credential in CI | _pending_ | See the settings below |

### Workers Builds settings

| | |
| --- | --- |
| **Worker name** | `src-timing-production` |
| **Root directory** | **`platform`** — *not* `platform/apps/timing` |
| **Build command** | `npm run build:worker --workspace=apps/timing` |
| **Deploy command** | `npx wrangler deploy --env production --config apps/timing/wrangler.jsonc` |
| **Build watch paths** | `platform/apps/timing/**`, `platform/packages/**`, `platform/package-lock.json` |

**The root directory is the part that is easy to get wrong.** `@src/shared` and `@src/db`
are npm workspace links that exist only because the install ran at `platform/`. Rooting the
build at `platform/apps/timing` installs there instead, never creates the links, and fails
on `Cannot find module '@src/shared'`.

**Deploy `apps/main` first.** Its Custom Domain is what creates the `new` DNS record; a
route has nothing to attach to until that exists.

**Move `src-race-timing` into the club organisation before connecting Cloudflare to it** —
doing it afterwards desynchronises the git integration. That is also the governance fix:
the repository currently sits in a personal account, which is a key-person dependency the
proposal claims is already mitigated.
