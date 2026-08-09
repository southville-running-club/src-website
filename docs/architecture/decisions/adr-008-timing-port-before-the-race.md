# ADR-008 — The timing port lands before Nightingale Nightmare, not after

**Accepted**, 9 August 2026. **Reverses the sequencing recorded in
[the plan](../../delivery/plan.md)**, which said the port happens *"after the Nightingale
Nightmare race, not before"*. Nothing else in Phase 4 changes.

| | |
| --- | --- |
| **Requirement** | [Risk](../../foundations/requirements.md#risk), [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [convergence](../../foundations/requirements.md#convergence) |

## Context

Two documents gave opposite answers to the same question, which is why this record exists
rather than an edit.

[The plan](../../delivery/plan.md) said the port waits until after the race, and gave the
right reason: *"racing on a freshly ported system is exactly what the [risk
constraint](../../foundations/requirements.md#risk) exists to prevent."* A race happens once
a year and cannot be re-run.

[The phases](../../delivery/phases.md) said Phases 3 and 4 both complete before the race,
with the port race-ready by mid-October.

**Leaving both in the repository was the actual defect.** Whichever answer is right, a
programme cannot be executed against two of them — and the one the committee reads
([the overview](../../delivery/overview.md)) carried the older answer, so the club would
have been told something the build was not doing.

## Decision

**The port lands before the race. Nightingale Nightmare 2026 is timed on Cloudflare,
reading the same Supabase project as the race's own sign-up page.**

Three things make this the lower-risk option rather than the braver one, and all three are
properties the club already has:

| | |
| --- | --- |
| **The gate is a rehearsal, not a deadline** | A [full manual race simulation](../../delivery/phases.md#the-gate-on-phase-4) signs the port off — multiple devices, real connectivity loss, the real race date. Mid-October is chosen so that simulation has a fortnight behind it |
| **The fallback is real and stays warm** | **The existing Vercel deployment is not switched off until the simulation passes.** Reverting is a URL, not a migration — the marshals' devices point somewhere else and the race runs on the system that ran Pass the Buck |
| **The alternative is not risk-free either** | Deferring means the results archive ([C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)) has no race data to derive from until 2027, and the port then happens against a database that has meanwhile filled with live sign-up and payment data rather than an empty one |

**The risk constraint is honoured by the simulation and the fallback, not by the calendar.**
"After the race" bought safety by not deploying; this buys the same safety by keeping the
old system available and refusing to sign off on anything but a rehearsal.

## Consequences

- **Mid-October 2026 is a real deadline**, and it is *race-ready*, not *deployed*. If the
  simulation finds something in the last week there must be room to fix it.
- **Vercel stays live until the simulation passes.** Decommissioning it is a separate,
  later step and is not part of Phase 4's "done".
- **The change freeze covers both applications** from the week before the race. They share
  a hostname and a repository, so this was already true.
- **The three things the port must not break** are unchanged and are now on the critical
  path: the IndexedDB offline queue and its idempotent-upsert contract, the TypeScript/SQL
  lockstep on bib resolution, and `Europe/London` pinning.
- **The service worker scope change is the rehearsal's first item.** `basePath: '/timing'`
  moves it to `/timing/`, and anyone with the app installed holds a registration for the old
  scope. That is the offline capture queue —
  [ADR-007](adr-007-one-hostname-paths-not-subdomains.md) already names it as the part to
  rehearse rather than assume.
- **Supabase Auth configuration becomes load-bearing on the shared project.** Magic links
  break silently if `site_url` and the redirect allowlist are wrong, and `config.toml` is
  what sets them on every merge — see
  [the auth block's guard](../../../platform/packages/db/tests/unit/config.test.ts).

## Exit cost

**Low, and it is the point.** If the simulation fails, the race runs on Vercel exactly as it
would have under the previous answer. The port is not thrown away — it is re-gated on the
next simulation. Nothing about the club's race history moves, because
[the timing platform's own Supabase project is untouched](../../delivery/runbooks/supabase-setup.md)
until the port deliberately merges the two.

## Revisit when

- **The race simulation does not pass by mid-October.** That is the trigger to run the race
  on Vercel, and it needs no further decision — it is this record's stated fallback.
- **The offline queue behaves differently under the new service worker scope** in rehearsal.
- **A second race is scheduled inside the port window**, which would remove the slack the
  mid-October date exists to provide.
