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

Two consequences the rewrite has to carry:

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

⚠️ **This said "no timing application code lives here yet, and none should until the port
happens deliberately" — and both halves are now wrong.**
[ADR-034](../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
supersedes ADR-008 in full: the platform is **rewritten here** rather than ported, using
`bindalshah/src-race-timing` as the specification rather than the source, and writing timing
code in this repository is ordinary work under the ordinary rules.

What exists is the `timing` schema
([ADR-035](../../../docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md)),
the pure domain logic ported with its tests in `packages/shared/src/timing/`, the events hub
and one race's page (#247), the marshal roster (#245), the entry list (#202, #249), the start
screen (#250), the **capture screen** (#203), the **anomalies list and the timing log** (#252),
**race status and finishing** (#253), and `/nn/<year>/results/` reading
`timing.results_for_event()`. ⚠️ **"Nothing that touches a race as it happens is built" is what
this said until 13 September 2026** — a crossing is recorded, resolved, labelled and the race
can be called finished. What is still missing is **publication**: no result reaches anybody, and
nothing wipes a rehearsal. The ladder of what "done" means is
[#257](https://github.com/southville-running-club/src-website/issues/257).

⚠️ **The capture screen is the one address here that needs JavaScript**, and it is the only
place on this platform where that is the answer rather than a defect: an offline queue in
IndexedDB has nothing to degrade to. Its no-script fallback is a server-rendered sentence
telling a marshal to write the bib and the time on paper. `public/sw.js` — plain JavaScript in
`public/`, because a service worker is registered by name and may not be given a build hash —
caches that screen so a reload with no signal does not strand somebody on a course.

**The gate is unchanged and the fallback is gone.** A full manual race simulation still signs
this off — multiple devices, real connectivity loss, the real race date. There is no second
host: `src-race-timing` keeps serving production, untouched, until it is switched off, and a
failed simulation cuts the Durable Objects leaderboard rather than the platform.

## What it proves, and who can see it

**`/timing` is staff-only since 11 September 2026.** `middleware.ts` reads the session and
refuses anybody without a `timing.*` permission — the signed-out public included — and
nothing links to it any more.

⚠️ **A refused request is rewritten to an address that matches no route**, so Next serves its
prerendered not-found page: real server-rendered HTML, status 404, with the banner, the
footer and the privacy notice on it, byte for byte what a genuinely missing address returns.

**It does not throw `notFound()`, and that was learned the expensive way.** Thrown during a
dynamic render — reading cookies makes it dynamic — `notFound()` returns an empty
`<html id="__next_error__">` shell with the whole page in the streamed payload for the client
to render. Signed out, that page had no `<h1>`, no banner and no footer in its HTML, so with
JavaScript off it was blank. The file's own header carries the measurements.

⚠️ **It reads the session and never writes one.** Cloudflare dispatches `/timing/*` here at
the edge, so `apps/main` cannot gate these requests — but only `apps/main` mints, refreshes
or slides a session. This refuses anything it is not sure of instead: no access token, a
missing or expired `src_ax`, or a failed `identity.my_permissions()` call. It can therefore
never extend a session; a volunteer whose token lapsed is put right by opening any page on
the club's side. The cookie names come from `@src/shared/session-cookies`, because a name two
Workers have to agree on should exist once.

**`/timing/health` stays public**, outside the route group. It is what `scripts/smoke.mjs`
reads daily against production, and what Playwright waits on before running anything — a
readiness check does not accept a 404, so gating it would stop every test from starting.

The deployment half it originally proved still holds: the OpenNext build produces a working
Worker, the path route beats `apps/main`'s Custom Domain on one hostname, and the Worker
reaches the database.

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

## The club's chrome, on a path the club does not own the framework of

This app is Next and `apps/main` is Astro, so a banner, a footer and a wordmark cannot be
one component. They are one *set of values* instead — `CLUB_LOGO`, `SITE_BANNER` and
`SOCIAL_LINKS` in `packages/shared` — with a dozen lines of JSX here and a dozen lines of
Astro there. `apps/main/tests/e2e/site.spec.ts` visits both front doors and asserts they
agree, because each app builds green on its own and nothing else would notice a drift.

Three of them arrived after the club's front door already had them, and the gap was visible
to anybody who reached `/timing` from a search: the club's colours, and no way back to the
club.

| | |
| --- | --- |
| `app/site-banner.tsx` | The bar that says which site this is, and the wordmark that links home |
| `app/site-footer.tsx` | The club's four social profiles, outside `<main>` so it is the one `contentinfo` |
| `metadata.icons` in `app/layout.tsx` | The browser-tab icon |

**The favicon is `/favicon.svg`, which this app does not serve.** It is
`apps/main/public/favicon.svg`, at the root of the hostname `/timing` is one path on — so
there is one icon for the whole site rather than a copy here to keep in step. `basePath`
prefixes `next/link` and leaves `metadata` alone, which is what makes the leading slash
mean what it says; the e2e assertion is the guard if that ever changes. Running this app
standalone on :8788 is the one place it 404s, because nothing serves the club's `public/`
there.

**The tab icon is the club's "SRC" monogram and the header is the full wordmark**, which is
a deliberate split rather than an inconsistency: 16px of tab strip cannot hold three words,
and a header has room for the club's name. See
[`docs/foundations/brand.md`](../../../docs/foundations/brand.md).

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
