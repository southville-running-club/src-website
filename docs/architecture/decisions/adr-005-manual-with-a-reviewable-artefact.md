# ADR-005 — DNS stays manual, with a committed zone file as the reviewable artefact

**Accepted**, 8 August 2026.

| | |
| --- | --- |
| **Requirement** | [Everything as code](../../foundations/requirements.md#everything-is-defined-as-code), [people](../../foundations/requirements.md#people), [shared ownership](../../foundations/requirements.md#shared-ownership) |
| **Options** | [infrastructure as code](../investigations/infrastructure-as-code.md) |

## Context

[Everything as code](../../foundations/requirements.md#everything-is-defined-as-code) is
foundational. Both DNS documents end with *"commit the zone as code — Terraform or
OpenTofu"* and stop there, so the question was which tool and where its state lives.

Counting the work first changed the question.

**Most of the platform is already code.** Schema, RLS and policies are CLI migrations;
deploys are git integration plus CI; Worker configuration is committed `wrangler.jsonc`. The
high-frequency work — the things that happen on every commit — is already automated,
reviewed and reversible.

**What is left is small.** About **sixteen DNS record changes across eight months**, then
roughly one a year. Plus around a dozen once-ever actions: two Cloudflare projects, a
Supabase project's settings, an R2 bucket. **Thirty dashboard actions in total**, then almost
none.

**Against that, tooling costs more than it saves.** DNSControl is about two evenings of setup
plus token rotation and upgrades; Terraform is three or four plus a state backend, locking
and a bootstrap problem — and Cloudflare currently advise against migrating to their v5
provider while they stabilise it. Two evenings to save a few minutes a month is negative
value in exactly the currency this programme exists to conserve.

**And the requirement is not asking for an apply mechanism.** Its own reasoning names four
failure modes: no history, no review, no rollback, no visibility to a second person. A
committed file plus a pull request plus a club-owned account fixes all four. **The reviewable
artefact is what matters; the apply mechanism is not.**

## Decision

**DNS records are changed by hand, against a committed zone file, with the change reviewed
before anybody opens a dashboard.**

1. **The exported BIND zone file is committed** to `docs/reference/`. Cloudflare exports *and*
   imports these, so it is a re-appliable artefact rather than merely a record of one.
2. **A record change is proposed as a diff to that file, in a pull request, and reviewed
   first.**
3. **Apply by hand, then re-export and confirm the file matches.** That is drift detection.
4. **Both volunteers are admins** on the club-owned Cloudflare account.

**No IaC tool is adopted now.** Not DNSControl, not Terraform, not OpenTofu.

### The principle this generalises to

**Automate by change frequency, not by category.**

| How often | How |
| --- | --- |
| **Every commit** — deploys, migrations, tests | **Automated** ([ADR-003](adr-003-local-development-and-pipeline.md)) |
| **Monthly-ish, high consequence** — DNS records | **Manual, but reviewed.** A [runbook](../../delivery/runbooks/) and a pull request |
| **Once, ever** — a project, a bucket, the nameservers | **Manual, and written down** |

## Consequences

- **Nothing enforces that a dashboard change went through a pull request.** This is the real
  cost, and it is accepted: two volunteers who review each other's work do not need a
  mechanism to compel it. It stops being acceptable when a third maintainer arrives.
- **Drift detection is a discipline, not a job.** Re-export and diff after every change. At
  one change a month that costs a minute; if it is skipped, the file quietly becomes fiction.
- **The zone file must be re-exported after the nameserver move**, because the Fasthosts
  export stops being the live reference at that point —
  [runbook](../../delivery/runbooks/nameserver-move.md) phase 7.
- **A record change now has a genuine review step**, which is more than the club has today and
  is the whole point.
- **No new dependency, no state file, no API token, no bootstrap problem**, and nothing extra
  for a third volunteer to learn.
- **Manual work is documented** — what, why, by whom, how to redo it — per the
  [pragmatic exception](../../foundations/requirements.md#everything-is-defined-as-code). That
  is the condition on which this decision is legitimate rather than merely convenient.

## Exit cost

**Near zero, and that is unusual enough to be worth saying.** The committed zone file is
exactly the input DNSControl, octoDNS or `cf-terraforming` would want. Adopting a tool later
means importing a file that already exists and is already correct — **this decision makes the
later adoption cheaper, not more expensive.**

## Revisit when

Any one of these, and DNSControl becomes worth its two evenings:

- **More than about one DNS change a month, sustained.**
- **A drift incident** — a record changed and nobody knew, or the committed file turned out
  not to match reality.
- **A third maintainer arrives.** Enforcement starts to matter more than trust.
- **The zone passes ~30 records**, or a second domain appears.

**Terraform or OpenTofu** only if the managed surface grows well beyond DNS. If that happens,
state goes in HCP Terraform's free tier — 500 managed resources, unlimited users, locking
included — or R2 via the S3-compatible backend. **Never in git.**
