# `apps/main` — the club's main front door

Static Astro plus one Worker. Serves **Nightingale Nightmare** today at
`nn.southvillerunningclub.co.uk`, and will gain `new.<apex>`, the apex and `www` without
moving anywhere —
[ADR-006](../../../docs/architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md).

**Currently a skeleton.** One page saying so, and a timestamp fetched from Postgres by the
Worker while it serves the request.

## Layout

```
src/pages/nn/     Nightingale Nightmare. Lives at /nn/ from day one, so <apex>/nn/
                  already works the moment the apex lands
src/pages/        index and 404 — what the apex and preview URLs serve
worker/routing.ts Which asset answers a request, given its hostname. Pure and tested
worker/index.ts   The handler: route, then fill in the health timestamp server-side
```

## How the hostname routing works, and why it matters

`nn.<apex>/` serves `/nn/`. Every other path on that hostname is prefixed too, so
`nn.<apex>/membership/` resolves to `/nn/membership/` and 404s.

**That negative is the load-bearing part.** From Phase 5 this build also contains the
unfinished club website, and none of it may be publicly reachable on the race domain.
"We will remember to check" is not a control, so it is asserted in three places:
`tests/unit/routing.test.ts`, `tests/worker/serves.test.ts`, and `tests/e2e/nn.spec.ts`.

Build assets Astro emits at the root — `/_astro/*`, the favicon — are served unprefixed,
because otherwise the page would load unstyled. That allowlist is deliberately tiny; adding
to it makes something reachable on every hostname.

**Locally it is the same rule**, because any hostname whose first label is `nn` counts:

| | |
| --- | --- |
| http://localhost:8787/ | The platform index — what the apex will serve |
| http://nn.localhost:8787/ | Nightingale Nightmare |
| http://nn.localhost:8787/membership/ | **404**, as it must be |

Browsers resolve `*.localhost` to 127.0.0.1 with no `/etc/hosts` entry, so the local shape
is the public shape rather than an approximation of it.

**This only works because `routes` live under `env.production`.** While they sat at the top
level, `wrangler dev` rewrote `request.url` to the custom domain and ignored the incoming
`Host` header entirely — every local request looked like the live hostname and nothing
could change it. Worth knowing if routes ever move back up.

## Commands

```bash
npm run dev          # astro dev, fast loop
npm run dev:worker   # wrangler dev, the real runtime
npm run build        # static output to dist/
npm run test:worker  # Workers runtime tests. Needs dist/ — build first
```

## Environment

Both values live in `wrangler.jsonc` — **local at the top level, production under
`env.production`** — and both are safe to expose by design: row-level security is what
enforces access, not the key.

That split is the safe direction. A plain `wrangler deploy`, which is the command somebody
runs by accident, publishes a Worker with **no hostname and an unreachable database**.
Loud and harmless. The inverse would put localhost config on the live race domain.

`env.production`'s Supabase block is byte-identical to `apps/timing`'s, and
`packages/shared/tests/unit/supabase-config.test.ts` fails if that ever stops being true —
because one database behind both front doors is what makes a results archive derived from
timing data possible at all.

**No third variable should be needed.** If the build appears to want a service role key,
the row-level security policy is wrong and that is the thing to fix.

## Manual steps

The [accepted exception](../../../docs/foundations/requirements.md#everything-is-defined-as-code)
to everything-as-code: what was done, why, by whom, and how to redo it.

**The custom domain is not on this list.** It is the `routes` entry in `wrangler.jsonc`,
and Cloudflare creates the DNS record and issues the certificate from it. Nothing is added
by hand at the registrar or in the DNS dashboard.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Worker and connect Workers Builds_ | Git integration needs no API token in CI, so there is no deploy credential to leak | _pending_ | See the settings below |
| _Set the production Supabase variables_ | They differ from the local ones; both are safe to expose | _pending_ | Worker → Settings → Variables. `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` |

### Workers Builds settings

| | |
| --- | --- |
| **Root directory** | **`platform`** — *not* `platform/apps/main` |
| **Build command** | `npm run build --workspace=apps/main` |
| **Deploy command** | `npx wrangler deploy --env production --config apps/main/wrangler.jsonc` |
| **Build watch paths** | `platform/apps/main/**`, `platform/packages/**`, `platform/package-lock.json` |

**The root directory is the part that is easy to get wrong.** `@src/shared` and `@src/db`
are npm workspace links, and they only exist because the install ran at `platform/`. Point
the root directory at `platform/apps/main` and Cloudflare installs *there* instead, the
links are never created, and the build fails on `Cannot find module '@src/shared'`.

**Build watch paths are not optional.** The free plan allows 500 builds a month, and
without them every push rebuilds every application — which is how that allowance gets spent
on no-ops. `platform/packages/**` must be in the list: a change to the shared timezone
module has to rebuild both applications.

After anything touching the zone, **send and receive a test email on a club address.** A
Worker custom domain cannot affect mail, and confirming it costs a minute.
