# ADR-006 — `apps/main`, hostnames declared in code, and the npm project under `platform/`

**Accepted**, 8 August 2026. Amends
[ADR-001](adr-001-one-monorepo.md); does not supersede it.

| | |
| --- | --- |
| **Requirement** | [Everything as code](../../foundations/requirements.md#everything-is-defined-as-code), [convergence](../../foundations/requirements.md#convergence), [people](../../foundations/requirements.md#people) |
| **Implements** | The skeleton — [issue #3](https://github.com/southville-running-club/src-website/issues/3) |

## Context

[ADR-001](adr-001-one-monorepo.md) settled **one monorepo, npm workspaces**, and sketched a
tree with `apps/nn` and `apps/www` as separate applications. Writing the first application
code made three things concrete that the sketch had left implicit.

**The question underneath all of them was whether a Cloudflare Worker is one application
per hostname.** If it is, then Nightingale Nightmare must be its own app now and be *moved*
into the website later — a migration nobody wants during Phase 5, and one the club would be
choosing to incur today.

It is not.

## Decision

### 1. `apps/main`, not `apps/nn`

**One application serves every club hostname**, gaining them over time:

| | Hostname | Phase |
| --- | --- | --- |
| Now | `nn.southvillerunningclub.co.uk` | 3 |
| November | `new.<apex>` | 5 |
| Before March 2027 | the apex and `www` | 7 |

Nightingale Nightmare's content lives at **`/nn/`** in the build from the first commit, so
`<apex>/nn/` already works the moment the apex lands. `worker/routing.ts` makes
`nn.<apex>/` an alias for it. **Nothing moves, and no URL breaks.**

`apps/timing` stays separate, and that is not in question: Next.js under
`@opennextjs/cloudflare` is a different build, a different runtime shape and a different
risk profile from static Astro.

**The load-bearing part is the negative.** From Phase 5 this build also contains the
unfinished club website, and none of it may be reachable on the race domain. Prefixing
every path with `/nn` is what guarantees that — `nn.<apex>/membership/` resolves to
`/nn/membership/`, which does not exist. It is asserted in three places rather than
remembered: a unit test, a Worker-runtime test, and a browser test.

### 2. Hostnames are declared in `wrangler.jsonc`, not clicked

```jsonc
"routes": [{ "pattern": "nn.southvillerunningclub.co.uk", "custom_domain": true }]
```

Cloudflare creates the DNS record and issues the certificate from that entry.

**This corrects
[infrastructure-as-code.md](../investigations/infrastructure-as-code.md#most-of-it-is-already-code)**,
which lists Cloudflare configuration as dashboard-only. The *build* configuration — root
directory, watch paths — still is. The **hostname** is not, and a new hostname is now a
reviewed pull request rather than a click. That is a gap closed in the direction the
requirement was already pointing.

### 3. The npm project lives in `platform/`

The repository root holds documentation. `package.json`, `tsconfig`, ESLint, Prettier,
`apps/` and `packages/` all sit under **`platform/`**, so a reader arriving at the root
sees `docs/`, `tools/`, `platform/` and nothing else.

Called `platform/` rather than `src/` because **`src-` already means Southville Running
Club** throughout this repository — `src-website`, `src-race-timing` — and a directory
named `src/` would read as the club rather than as source. It is also
[the glossary's own word](../../foundations/glossary.md) for the thing it contains.

## Consequences

- **ADR-001's tree is amended**, not replaced. One repository, npm workspaces, no Turborepo
  and no Nx — all unchanged.
- **CI runs with `working-directory: platform`**, and Cloudflare's root directory is
  `platform/apps/main` or `platform/apps/timing`.
- **A hostname change is a diff.** Adding `new.<apex>` in Phase 5 is one entry and a review.
- **`run_worker_first: true`** means the Worker sees every request rather than only the ones
  that miss an asset. That is one invocation per request against a 100,000/day free
  allowance — not a constraint for a running club, but it is a real number and worth knowing.
- **`nn.<apex>/nn/` also resolves**, a duplicate address, answered with a canonical link
  rather than a redirect.
- **Coupling accepted, and it is small.** The two-week Nightingale Nightmare deadline and
  the eventual website now share an application. They barely overlap in time — NN is done by
  22 August, the race is 1 November, Phase 5 starts in November — and a race-week change
  freeze already freezes the whole repository under ADR-001.

## What building it actually found

Recorded because each cost time and none is written down anywhere else.

| | |
| --- | --- |
| **Migration and deploy are not sequenced** | Workers Builds triggers on the push, not on a green GitHub Actions run. Nothing orders `supabase db push` before the code that uses it. **This is survivable only because [expand–migrate–contract](../principles.md#expand-migrate-contract) is a principle** — if a change ever needs the migration first, that change is what to fix. The alternative costs a Cloudflare API token in CI, which [is the thing git integration was chosen to avoid](../investigations/deployment.md#cloudflare--git-integration-no-credential-in-ci) |
| **`wrangler dev` cannot exercise hostname routing** | With `routes` configured it rewrites `request.url` to the custom domain and ignores the incoming `Host` header entirely. ADR-003 calls `wrangler dev` "the honest one"; for this it is not. `@cloudflare/vitest-pool-workers` runs the same runtime and preserves the URL, so the Worker tests are the real check |
| **An ambient `NODE_ENV=development` breaks the Next.js build** | It resolves React's development build while the build expects production, and surfaces as `Cannot read properties of null (reading 'useContext')` while prerendering a page nobody wrote. Pinned in the build script. Cost an hour, and would have cost the same hour again in Phase 4 |
| **Duplicate React or Next in the workspace breaks it differently** | Same root cause, different symptom — `Expected workStore to be initialized`. Version churn in one workspace leaves a nested copy behind. `npm dedupe`, and check |
| **`opennextjs-cloudflare build` runs one of the app's own npm scripts** | So naming that script `opennextjs-cloudflare build` makes it invoke itself. It **recursed 205 levels deep and took the laptop down**. `buildCommand` now names a dedicated `build:next` script that does nothing else, so the loop cannot form however `build` is later edited. The three build scripts in `apps/timing` are deliberately redundant and must not be merged |
| **`initOpenNextCloudflareForDev()` spawns workerd as a side effect of loading the config** | And `next build` loads the config again in every static-generation worker. Guarded to `NODE_ENV === 'development'`. Unguarded it is a slower version of the same fork bomb |

## Exit cost

**Low, and lower than the alternative.** Splitting `apps/main` into two applications later
is a directory move plus a second `wrangler.jsonc` — an afternoon. Merging two applications
into one would mean reconciling two builds, two configurations and two sets of URLs.

That asymmetry is the whole argument: **the reversible choice is the one that keeps the
hostnames together.**

## Revisit when

- The club website outgrows sharing an application with a race site — many contributors, or
  build times that make one deploy block another.
- Cloudflare changes how custom domains are declared.
- A hostname needs to serve something this routing cannot express — a redirect-only domain,
  or a third-party origin behind a path.
