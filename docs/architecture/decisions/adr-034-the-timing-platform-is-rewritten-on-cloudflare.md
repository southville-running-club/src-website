# ADR-034 — The timing platform is rewritten on Cloudflare, and Vercel is switched off

**Accepted**, 10 September 2026. **Supersedes**
[ADR-008](adr-008-timing-port-before-the-race.md) — both its *port* framing and its standing
Vercel fallback. What ADR-008 got right and this record keeps: the gate is a full manual race
simulation, and three named things must not be broken.

| | |
| --- | --- |
| **Requirement** | [Risk](../../foundations/requirements.md#risk), [continuity](../../foundations/requirements.md#continuity), [convergence](../../foundations/requirements.md#convergence), [C5](../../foundations/requirements.md#c5--capture-race-timing-data-tolerant-of-no-signal) |
| **Supersedes** | [ADR-008](adr-008-timing-port-before-the-race.md), in full |

## Context

ADR-008 decided the timing platform moves to Cloudflare before Nightingale Nightmare, and
bought its safety by keeping the Vercel deployment live as a standing fallback. Two things
about that have changed, and neither is a detail.

**The word was always *port*, and the work is a rewrite.** Even ADR-008's own
[phase](../../delivery/phases.md#phase-4--the-timing-app-on-cloudflare) admits the live
leaderboard is *"a rebuild, not a port"*, and the
[architecture review](../../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know)
names three more pieces of genuinely new work — the solo finish path, age-band categories that
do not exist, and single-event hardcoding. Against that, a lift-and-shift would have carried
`@supabase/ssr`, Tailwind v4, a second `london-time.ts`, a second Supabase client and a second
auth model into a workspace that already has settled answers for all five. **The cheaper thing
is to write the application here, to this repository's conventions, using
`bindalshah/src-race-timing` as the specification rather than as the source.** Its
`DECISIONS.md` is 136 KB of append-only reasoning, and that is what makes a rewrite viable
rather than a guess.

**Two hosts is not a fallback, it is two systems.** ADR-008's fallback was real when the two
deployments were the same code reading the same database. Under a rewrite they are different
code, and — until the data import — different Supabase projects. Keeping Vercel warm would
mean maintaining a second implementation of the club's most safety-critical surface, on a
vendor the club is otherwise leaving, indefinitely. That is a continuity liability rather than
a continuity mitigation.

## Decision

**One timing platform, written in `apps/timing`, deployed as a Worker on
`new.<apex>/timing`. Vercel is decommissioned once the race simulation passes.**

| | |
| --- | --- |
| **The old repository is a reference, not an ancestor** | No `git filter-repo`, no history merge, no transfer prerequisite. `bindalshah/src-race-timing` stays where it is, serving production, until it is switched off |
| **Pure domain logic is copied with its tests** | `lib/bib.ts`, `results.ts`, `awards.ts`, `anomaly.ts`, `prize-export.ts`, `result-export.ts` and `registration/{parser,pairing,bib-assignment}.ts` are tested pure functions. Copying them is cheaper and safer than re-deriving them |
| **Everything else is written here** | Pages, components, Supabase access, auth, migrations, tests. `packages/shared` supplies the timezone module, the Supabase client and the brand |
| **The gate is unchanged** | A full manual race simulation, multiple devices, real connectivity loss, the real race date — including the **true two-marshal end-to-end path**, which the old app's own logs record as never fully verified |
| **What the gate now decides** | **Scope, not host.** There is no other host. If the simulation fails, the thing that gets cut is the Durable Objects leaderboard, not the platform |

**Three things the rewrite may not improve**, carried from ADR-008 unchanged because each was
learned at a finish line:

1. **The IndexedDB offline queue** — `awaiting-bib → queued → syncing → removed`, with `failed`
   a distinct state, and a client-generated UUID as `crossings.id` so a retry is idempotent
   under `upsert(onConflict: 'id')`.
2. **The TypeScript/SQL lockstep on bib resolution.** A bib is an opaque string, exact equality
   only — never `parseInt`, never leading-zero normalisation, `"0311" ≠ "311"`.
3. **`Europe/London` pinning**, through
   [`packages/shared/src/london-time.ts`](../../../platform/packages/shared/src/london-time.ts)
   and nothing else. The race is the weekend after the clocks go back.

And one behaviour that is a decision rather than an implementation detail: **an anomaly flags
and never blocks.** The marshal resolves and confirms anyway.

## Consequences

- **Vercel's decommission is part of this record's "done"**, where ADR-008 put it outside.
  Removing its domains, deleting the project and revoking its Supabase keys and GitHub access
  are steps, not a later tidy-up.
- **The old Supabase project `ovpvzabtjxbszsqschqy` outlives the old application**, and is
  deleted only once a verified export is stored elsewhere. It holds Pass the Buck 2026, which
  is the only race history the club has and the whole subject of
  [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically).
  **The free tier has no automated backups**, so a manual export taken before any of this
  starts is the actual mitigation.
- **The data import is a separate, later, one-shot step**, after the application works. The
  schema is designed so the old rows land — see
  [ADR-035](adr-035-the-timing-schema-joins-this-project.md).
- **The change freeze covers the whole repository**, as it already did. Nightingale Nightmare
  entries and Christmas party tickets are frozen alongside timing, which is a cost this record
  accepts rather than solves.
- **`apps/timing`'s holding page is replaced, not extended.** The route, the `basePath` and the
  Workers Builds configuration it proved are what the rewrite inherits.
- **The service worker scope moves to `/timing/`**, and anyone with the old app installed holds
  a registration for the old scope. [ADR-007](adr-007-one-hostname-paths-not-subdomains.md)
  already names this as the part to rehearse rather than assume, and under a rewrite the old
  installation points at a different origin entirely.
- **Bundle size and CPU are still unmeasured** — 3 MB compressed and 10 ms CPU on the free
  Workers plan. Measuring them against real code is the first thing worth doing, because the
  answer can change the plan and cannot be inferred.
- **`CLAUDE.md`'s stop-and-ask on the timing platform is narrowed** to `src-race-timing` and
  the old project. Writing timing code in this repository stops being the thing that ends a
  task.

## Exit cost

**Higher than ADR-008's, and stated plainly.** ADR-008 could revert by telling marshals a
different URL. This cannot: after cutover there is one implementation. What replaces that
reversibility is that **nothing is switched off until the simulation passes** — the old system
keeps running, untouched, for the whole of the rewrite. The irreversible moment is the
decommission, and it is deliberately the last step rather than a consequence of the first.

## Revisit when

- **The race simulation does not pass.** The response is to cut the Durable Objects leaderboard
  back to Supabase Realtime and re-run it — not to keep Vercel.
- **Bundle size or CPU measurement fails against the free plan's limits**, which turns a
  technical measurement into a money decision for the committee.
- **The offline queue behaves differently under the new service worker scope** in rehearsal.
