# Deployment architecture

How a commit becomes production — on Cloudflare, and on Supabase.

Two systems, two different answers, and the difference is entirely about **credentials**.

---

## Pages or Workers

**The most time-sensitive open question in this folder.**

Cloudflare's own position changed, and the existing documentation predates it:

> *"If you are starting a new project, use Workers instead of Pages. Pages continues to
> work, but new features and optimizations are focused on Workers... all investment,
> optimizations, and feature work will be dedicated to improving Workers."*
> — [Cloudflare](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

Workers gained static-asset hosting, which was the thing Pages existed for. The two
products have been converging, and Workers is the survivor.

### What this does and does not change

| | |
| --- | --- |
| **Nightingale Nightmare v1** | **Unchanged — stay on Pages.** Workers custom domains require an active Cloudflare zone, and the club's zone is at Fasthosts until the apex cutover. Pages is the only Cloudflare product that serves `nn.southvillerunningclub.co.uk` today |
| **The main website** | **Should be a Worker.** It is built after the DNS move, so the constraint is gone by then |
| **The timing platform port** | Workers. It was always going to be — the Next.js adapter targets Workers |
| **Nightingale Nightmare v2** | Migrates from Pages to Workers with the rest |

**This is a further argument for [moving the DNS first](../../delivery/dns-first.md).** That
ordering was chosen to take the risky change in a quiet week; it turns out to also decide
whether the club's main build starts on the supported path or the legacy one.

### The Astro consequence

Worth stating because it simplifies things rather than complicating them:

> *"For static-only sites, if you want to use Astro as a static site generator, you do not
> need the Astro Cloudflare adapter."*

The [build brief's adapter
analysis](../../delivery/nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything)
concluded *"static Astro with no adapter, plus a Pages Function"* — and that conclusion
survives the Pages/Workers change intact. A static build plus one function endpoint runs on
either product. **The output is the portable thing**, which is exactly why it was chosen.

Note also: **Astro 6 requires Node 22 or higher**, which the build brief already pins in
`.nvmrc`.

---

## Cloudflare — git integration, no credential in CI

| | |
| --- | --- |
| **Trigger** | Push to `main` deploys production. Every pull request gets a preview deployment automatically |
| **Mechanism** | Cloudflare's git integration — Cloudflare pulls from GitHub and builds. Available for **both** Pages and Workers |
| **Why not `wrangler deploy` from GitHub Actions** | It needs a Cloudflare API token as a repository secret. Git integration needs none, and **a credential that does not exist cannot leak** |
| **Monorepo** | Root directory plus **build watch paths** per project, so a website change does not rebuild the race site |
| **Build budget** | **500 builds a month** on the free plan. Without watch paths, every push builds every app — which is how that gets spent on no-ops |
| **Config as code** | `wrangler.jsonc` committed per app |
| **Static asset limit** | **20,000 assets per version** on the free plan (100,000 on paid). A 60-page site with a document archive is nowhere near it, but a photograph archive would be — another reason files belong in R2 |

### Versions, rollback and gradual deployment

Workers gives three things Pages does not, and one of them matters for race day:

| | |
| --- | --- |
| **Versions** | Every deployment is a retained, addressable version |
| **Preview URLs** | Versioned (automatic per version) and aliased (a stable human-readable name). Both on `workers.dev` — [they cannot run on a custom subdomain](networking.md#preview-urls-and-their-one-limitation) |
| **Gradual deployments** | Percentage-based traffic splitting between two versions, with version affinity so a user does not flip between them mid-session |
| **Rollback** | Promote a previous version. Fast, and it is the actual answer to *"every change has a previous state to return to"* |

**Gradual deployment is over-engineering for a club website** and worth knowing about for
exactly one case: the timing platform, where the [risk
constraint](../../foundations/requirements.md#risk) is real and a bad deploy on race night
cannot be un-run. Even there, a change freeze is the simpler control.

---

## Supabase — CI, which does need a credential

There is no equivalent of git integration for a database. This is the one place a deploy
credential is accepted, and the asymmetry is deliberate rather than an oversight.

| | |
| --- | --- |
| **Trigger** | Merge to `main` runs `supabase db push` for the schemas this repository owns |
| **Secrets** | `SUPABASE_ACCESS_TOKEN`, project ref, database password — GitHub Actions secrets, never in the repository |
| **On a pull request** | Migrations are **validated, not applied**. A preview deployment pointing at production data is a personal-data problem, not a convenience |
| **Scoping** | `--schema club,intake`, so this repository never proposes dropping the timing app's tables |
| **Never** | `supabase db reset` against a remote. It is a local command |
| **Race weeks** | No migrations during a [change freeze](../../foundations/glossary.md#platform-and-delivery) |

**Why accept the credential.** The alternative is a volunteer running migrations from a
laptop — unreviewed, unlogged, invisible to the other volunteer, and a direct failure of
[everything as code](../../foundations/requirements.md#everything-is-defined-as-code). A
scoped token in GitHub Actions secrets is the smaller risk, and it is the mainstream
pattern.

---

## What a change actually looks like

End to end, so the shape is concrete rather than implied.

| | |
| --- | --- |
| **1. Branch** | From `main` |
| **2. Local** | `supabase start`, edit `supabase/schemas/`, `supabase db diff` to generate the migration, build and test against the local stack. [Local development](local-development.md) |
| **3. Pull request** | CI runs lint, unit tests, Worker tests, a build, and Playwright with axe. Migrations validate. Cloudflare posts a preview URL |
| **4. Review** | The other volunteer reads the diff and opens the preview. **This is what [shared ownership](../../foundations/requirements.md#shared-ownership) means in practice** |
| **5. Merge** | Migrations apply, then Cloudflare builds and deploys |
| **6. If wrong** | Roll back the Worker version immediately. **Roll the schema forward, never back** — that is what expand–migrate–contract is for |

**Ordering within step 5 matters.** Expand the schema first, deploy code that tolerates
both shapes, contract later. The timing app's registration migration
[already documents this by hand](../../reference/timing-app-review.md#what-is-strong) because
it hit a `42703` window in production.

---

## Environments

| | Cloudflare | Supabase |
| --- | --- | --- |
| **Local** | `wrangler dev` / `astro dev` | `supabase start` — full local stack in Docker |
| **Preview** *(per PR)* | Automatic preview deployment on `*.workers.dev` | **No preview database** — branching is Pro-only. Previews point at local or staging, never production |
| **Staging** | Optional | Optional, and **it will pause after a week idle** |
| **Production** | Push to `main` | Migrations on merge |

**The gap worth naming:** Cloudflare gives a free preview environment per pull request and
Supabase does not. That asymmetry is why [local development](local-development.md) carries
more weight here than it would on a platform with free database branching — the laptop *is*
the test environment.

---

## Secrets

| | Where | Notes |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | Cloudflare project env vars, `.env` locally | Safe to expose |
| `PUBLIC_SUPABASE_ANON_KEY` | Cloudflare project env vars, `.env` locally | Safe to expose — **RLS enforces access** |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions secret | CI only. Never in Cloudflare, never in the browser |
| Database password | GitHub Actions secret | CI only |
| Stripe keys | Cloudflare secret binding, when payments exist | Behind the [governance gates](../../foundations/requirements.md#legal-and-governance) |
| **Service role key** | **Nowhere in any repository or client bundle** | If a build wants it, the RLS policy is wrong |

`.env` is gitignored; `.env.example` is committed with empty values.

Any secret that ever existed in a commit is **compromised and must be rotated**, not
deleted — git history keeps it.

---

## Still to answer

| | |
| --- | --- |
| **Workers or Pages for the main website** | Cloudflare says Workers. It depends on the DNS move landing first, which is already the plan |
| **Whether Nightingale Nightmare migrates to Workers**, and when | Not urgent. Sensibly bundled with the main build |
| **Whether the timing platform keeps deploying from Vercel** during the transition | It works. Moving it is [risk](../../foundations/requirements.md#risk), and only the hostname needs to change first |
| **Who holds the Cloudflare and Supabase billing relationship** | Both volunteers can reach the accounts; only one can hold a card. [Governance](../../foundations/requirements.md#shared-ownership) |
| **Whether CI enforces the stale-types check** from day one | Cheap to add early, annoying to retrofit |
