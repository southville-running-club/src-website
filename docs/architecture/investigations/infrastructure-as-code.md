# Infrastructure as code — how much, and whether a tool earns its keep

[Everything as code](../../foundations/requirements.md#everything-is-defined-as-code) is a
**foundational requirement**, not a preference. Both DNS documents end with *"commit the zone
as code — Terraform or OpenTofu"* and stop there.

This works out what that actually requires. **The answer is less tooling than the phrase
implies**, and the reason is arithmetic rather than opinion.

Decided in
[ADR-005](../decisions/adr-005-manual-with-a-reviewable-artefact.md).

---

## Most of it is already code

Before asking which tool, ask what is actually uncovered.

| Surface | Already code? | How |
| --- | --- | --- |
| **Supabase schema, RLS, policies, triggers** | ✅ | CLI migrations — [ADR-002](../decisions/adr-002-schema-layout.md), [ADR-003](../decisions/adr-003-local-development-and-pipeline.md) |
| **Deploys** | ✅ | Cloudflare git integration; migrations in CI — [ADR-003](../decisions/adr-003-local-development-and-pipeline.md) |
| **Worker/Pages config and bindings** | ✅ | `wrangler.jsonc`, committed |
| **Local environment** | ✅ | `supabase/config.toml`, `seed.sql`, `.nvmrc` |
| Supabase project settings | Mostly | `config.toml` covers most; a few dashboard-only |
| Cloudflare build config — root directory, watch paths | ❌ | Dashboard. Set **once per app** |
| R2 buckets | Mostly | wrangler |
| Secrets and environment variables | ❌ | **Correctly not code** |
| **DNS records** | ❌ | **The actual gap** |

**The high-frequency work is already automated.** Schema changes and deploys happen on every
commit and are already reviewed, tested and reversible. What is left for any additional tool
is the low-frequency tail — and the only real item in it is DNS.

---

## How much is there actually to do?

The question that decides this. Counted, not estimated.

### DNS changes between now and Squarespace being switched off

| | Record touches |
| --- | --- |
| `nn` hostname | 1 |
| Lower every TTL to 300 | 1 bulk action |
| Import the zone into Cloudflare | 1 action |
| **Nameserver change at Fasthosts** | 1 action *(not a record — a registrar setting)* |
| `timing` hostname | 1 |
| `new` hostname | 1 |
| Resend sending subdomain and its DKIM | ~3 |
| Apex ×4 and `www` repointed at cutover | 5 |
| SPF tidy; `new.` → apex redirect | 2 |
| **Total** | **~16, across 8–10 sittings, over eight months** |

**After April 2027: approximately zero.** A running club's DNS does not change. Perhaps one
record a year, when something new gets a hostname.

### Everything else, ever

| | Actions | Frequency |
| --- | --- | --- |
| Cloudflare projects — 2 apps, build config, watch paths, env vars | ~8 | **Once** |
| Supabase project settings | ~3 | **Once** |
| R2 buckets | 1–2 | **Once** |

> **Roughly thirty dashboard actions across eight months, then almost none.**

---

## What a tool would cost

| | Setup | Ongoing |
| --- | --- | --- |
| **Manual + committed zone file** | **Zero.** [Plan](../../delivery/plan.md) step 23 already requires the file | **None** |
| **DNSControl** | ~2 evenings — install, learn its JavaScript DSL, express the zone, create a scoped API token, wire CI | Token rotation, tool upgrades, one more thing a third volunteer must learn |
| **Terraform / OpenTofu** | ~3–4 evenings — all of the above, plus a state backend, locking, and a bootstrap ordering problem | Provider churn. **Cloudflare currently advise against migrating to provider v5** while they stabilise it |

**Against ~16 changes in eight months and ~1/year thereafter, none of the tooling pays for
itself.** Two evenings of setup to save a few minutes a month is negative value, and it is
negative in the currency the whole programme is trying to conserve — volunteer time.

There is also a *boring* argument, and it cuts against the tools rather than for them.
[People](../../foundations/requirements.md#people) requires that a third person can pick this
up cold. A dashboard plus a written runbook is more pick-up-able than a JavaScript DSL or an
HCL state machine.

---

## What the requirement is actually protecting against

Worth being precise, because "everything as code" is easy to read as "everything must be
applied by a tool", and that is not what it says.

The requirement's own reasoning:

> The current site's state lives in a browser session: **no history of what changed, no
> review before it goes live, no rollback, and no way for a second person to see what the
> first did.**

Four failure modes. **A tool is not what fixes them:**

| Failure mode | What actually fixes it |
| --- | --- |
| No history of what changed | **A committed zone file** |
| No review before it goes live | **A pull request against that file, before anyone touches a dashboard** |
| No rollback | **The previous version of that file** |
| No way for a second person to see | **A club-owned account with both volunteers as admins** |

None of those four requires an apply mechanism. **The reviewable artefact is what matters;
the apply mechanism is not.**

### Manual, but reviewed

1. **Commit the exported BIND zone file.** Cloudflare **exports and imports** these, so the
   file is a re-appliable artefact rather than merely a record of one.
2. **A record change is proposed as a diff to that file, in a pull request, and reviewed**
   before anybody opens a dashboard.
3. **Apply it by hand, then re-export and confirm the file matches.** That is drift
   detection. Manual, but it works, and at one change a month it costs a minute.
4. **Both volunteers are admins** on a club-owned account.

What this gives up, honestly: **automatic apply**, and **enforcement** that nobody clicks
without a pull request. For two volunteers who trust each other, that is the acceptable gap —
and it is exactly the
[pragmatic exception](../../foundations/requirements.md#everything-is-defined-as-code) the
requirements already grant.

---

## The principle: automate by change frequency, not by category

| How often | How |
| --- | --- |
| **Every commit** — deploys, migrations, tests | **Automated.** Already decided |
| **Monthly-ish, high consequence** — DNS records | **Manual, but reviewed.** A [runbook](../../delivery/runbooks/) and a pull request |
| **Once, ever** — a project, a bucket, the nameservers | **Manual, and written down** |

The mistake this avoids is treating "infrastructure" as one category with one answer. The
club's infrastructure spans four orders of magnitude of change frequency, and the right tool
differs at each end.

---

## When this should change

Conditions, not hopes — the [decision log's own
standard](../../decisions/decision-log.md#revisit-when-not-revisit-if).

**Adopt DNSControl** when any of these becomes true:

- **More than about one DNS change a month, sustained.**
- **A drift incident** — a record changed and nobody knew.
- **A third maintainer arrives**, so enforcement starts to matter more than trust.
- **The zone passes ~30 records**, or a second domain appears.

**Why DNSControl rather than Terraform, if it comes to that.** It is stateless — git is the
state — so it avoids the backend, the locking and the bootstrap problem entirely. It is
purpose-built for DNS. And it manages the **Cloudflare proxy flag from config**, which is the
club's single largest DNS hazard: [eleven records that must not be
orange](../../delivery/dns-first.md#the-proxy-default-is-the-real-hazard), expressed as
reviewed code. octoDNS is the YAML-based equivalent and would also do.

**Reach for Terraform or OpenTofu** only if the surface grows well beyond DNS — several
domains, many Cloudflare resources, or an environment worth reproducing from scratch.

### If Terraform is ever adopted, state storage is free and solved

| | |
| --- | --- |
| **HCP Terraform free tier** | **500 managed resources, unlimited users**, state storage and locking included. The club would use perhaps thirty |
| **R2 via the S3-compatible backend** | Cloudflare documents it; the club already has R2 and pays no egress. **State-locking behaviour needs confirming** |
| **Committed to git** | ❌ **Never.** State holds secrets in plaintext |
| Local state only | ❌ Fails [shared ownership](../../foundations/requirements.md#shared-ownership) |

Relevant resources if it happens: `cloudflare_zone`, `cloudflare_dns_record` (v5) /
`cloudflare_record` (v4), `cloudflare_pages_project`, `cloudflare_pages_domain`; and
`supabase_project`, `supabase_settings`, `supabase_branch`. Existing resources import via
`cf-terraforming generate` then `cf-terraforming import`, which emits `terraform import`
commands to run by hand.

**Note the Supabase boundary:** there is **no schema resource**. Terraform would own the
project and its settings; migrations would still own the contents — which is what
[ADR-002](../decisions/adr-002-schema-layout.md) and
[ADR-003](../decisions/adr-003-local-development-and-pipeline.md) already assume.

---

## What stays manual on purpose, whatever else changes

| | Why |
| --- | --- |
| **The nameserver change** | No Fasthosts API. Done once, ever |
| **Account creation** | Cannot be code, and should not be |
| **Secrets** | GitHub Actions secrets and Cloudflare secret bindings. **Code is the wrong place** |
| **The first R2 bucket**, if Terraform state ever lives there | Bootstrap ordering — the backend must exist before anything can use it |

Each documented per the pragmatic exception: **what was done, why, by whom, and how to redo
it.**

---

## Still to answer

| | |
| --- | --- |
| **Does R2's S3-compatible backend support state locking?** | Only matters under Terraform, which is not being adopted |
| **Which Supabase project settings are dashboard-only** and cannot reach `config.toml` | Small, but they are the ones that will drift |
| **Where the committed zone file lives** | Proposed `docs/reference/`. It is a reference artefact, not documentation |
| **Does anything enforce the re-export-and-diff step**, or is it discipline? | Discipline for now. A scheduled CI job that exports and diffs would automate the *detection* without automating the apply — cheap, and worth considering later |
