# `apps/timing` — the race-timing platform on Cloudflare

Next.js 16 under `@opennextjs/cloudflare`, deployed as a Worker at
`timing.southvillerunningclub.co.uk`.

**This is the deployment half of [Phase
4](../../../docs/delivery/phases.md#phase-4--the-timing-app-on-cloudflare), done early and
on purpose.** The phases document asks for exactly this:

> Stand up a hello-world Worker on `timing.<apex>` early — proving Workers Builds, the
> custom domain and Supabase connectivity with a page that has nothing in it. Then the port
> only has to prove the application half, and every failure after that is application code.

**No timing application code lives here yet**, and none should until the port happens
deliberately. The real application is `src-race-timing`, it still runs from Vercel, and it
stays the fallback until a full manual race simulation passes.

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

Locally it answers on **http://timing.localhost:8788/**, alongside
`http://nn.localhost:8787/` — the same shape as the two live subdomains. Unlike `apps/main`
there is no hostname routing here: this Worker serves everything at the root, exactly as
the timing application's own routes (`/live/…`, `/admin/…`, `/marshal/…`) expect.

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

The custom domain is **not** here — it is the `routes` entry in `wrangler.jsonc`, and
Cloudflare creates the DNS record and issues the certificate from it. That record is
additive: nothing resolved `timing.southvillerunningclub.co.uk` before, so it cannot break
anything that exists.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Worker and connect Workers Builds_ | No deploy credential in CI | _pending_ | See the settings below |
| _Set the production Supabase variables_ | Both safe to expose | _pending_ | Worker → Settings → Variables. **Must be the same project as `src-main`** |

### Workers Builds settings

| | |
| --- | --- |
| **Root directory** | **`platform`** — *not* `platform/apps/timing` |
| **Build command** | `npm run build:worker --workspace=apps/timing` |
| **Deploy command** | `npx wrangler deploy --env production --config apps/timing/wrangler.jsonc` |
| **Build watch paths** | `platform/apps/timing/**`, `platform/packages/**`, `platform/package-lock.json` |

**The root directory is the part that is easy to get wrong.** `@src/shared` and `@src/db`
are npm workspace links that exist only because the install ran at `platform/`. Rooting the
build at `platform/apps/timing` installs there instead, never creates the links, and fails
on `Cannot find module '@src/shared'`.

**Move `src-race-timing` into the club organisation before connecting Cloudflare to it** —
doing it afterwards desynchronises the git integration. That is also the governance fix:
the repository currently sits in a personal account, which is a key-person dependency the
proposal claims is already mitigated.
