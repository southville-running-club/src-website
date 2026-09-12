# ADR-038 — The live leaderboard is staff-only in 2026, and the results page is the only public surface

**Accepted**, 12 September 2026. **Supersedes** the public-leaderboard assumption carried by
[ADR-034](adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)'s consequences and by
`phases.md`'s *"Known work beyond a straight port"* row — not those records in full.

| | |
| --- | --- |
| **Requirement** | [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C6](../../foundations/requirements.md#c6--show-live-race-progress-to-spectators), [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) |
| **Supersedes** | The assumption only — ADR-034 and ADR-035 stand |

## Context

**The club's rule for results is settled and it is strict.** Nobody outside `nn.results.read`
sees a result until the race has finished and somebody publishes it. `/nn/<year>/results/`
answers 404 to everybody else, the signed-out public included, and has since #237. The
migration that granted `nn.results.read` says *"until published"* in its own header.

**The old application's rule was the opposite.** `/live/<slug>` was **fully anonymous** —
public-read policies on `events`, `teams`, `runners` and `crossings`, no session at all — and
spectators at Ashton Court watched it on their phones. That is what
[C6](../../foundations/requirements.md#c6--show-live-race-progress-to-spectators) asks for, in
as many words: *"A public leaderboard … for people standing at the finish and for family
watching from home."*

**Both cannot be true, and nothing had noticed.** A live leaderboard *is* provisional results,
published continuously, to anybody who has the address. ADR-034 carries the old assumption
forward without examining it — its consequences table names the Durable Objects leaderboard as
the thing the simulation may cut, and says nothing about who may open it — and `phases.md`
repeats it. So the rewrite was on course to build, in the same six weeks, a surface that
refuses the public a finished result and a surface that hands them a running one.

**This is a decision about who may look, not about how it is built.** The Durable Objects
choice, the hibernatable WebSockets and the 200-connection argument against Supabase Realtime
are untouched. A permissioned leaderboard is the same leaderboard with one check at the door.

## Decision

**In 2026 the live leaderboard is staff-only, and `/nn/<year>/results/` after publication is
the only public surface for anything about a race.**

| | |
| --- | --- |
| **Who may open the leaderboard** | Somebody holding `timing.event.manage` or `timing.crossing.resolve`. **Not a new permission** — a seventh `timing.*` slug is a decision in its own right, and this one has no separate audience to justify it. #204 may argue for one in its diff if building it shows a reason |
| **What the public sees during a race** | Nothing. No spectator address, no projected public page, no unlisted URL |
| **What the public sees afterwards** | `/nn/<year>/results/`, once `publish_results()` (#241) has run, and then permanently |
| **The `anon` grant list in `timing`** | `results_for_event()` and nothing else, and only meaningful after publication. `timing.test.ts` pins it, so a second entry is a decision somebody takes in a diff |
| **What is not decided here** | Whether 2027 has a spectator screen. This record is scoped to this race deliberately — see *Revisit when* |

**The leaderboard read is its own function.** `results_for_event()` is not it: that function
returns runner names and is the *published* shape, gated on `nn.results.read`. A leaderboard
asks a different question of a race that is still running, and it answers to a different
permission.

## Consequences

- ⚠️ **[C6](../../foundations/requirements.md#c6--show-live-race-progress-to-spectators) is
  not met in 2026, and this record does not pretend otherwise.** C6 asks for a *public*
  leaderboard for *"family watching from home"*, and that is exactly what is being declined.
  What is delivered against C6 is the live push machinery and a staff audience for it; the
  public half is deferred, not built and hidden. **A capability this platform does not meet is
  worth more written down than quietly re-scoped**, because the next person reading C6 will
  otherwise assume it shipped.
- **The finish-line spectator experience is lost for one race.** It existed at Pass the Buck
  2026 and it will not exist at Nightingale Nightmare 2026. That is the price, it is known,
  and it is smaller than the alternatives: publishing provisional results to the public
  contradicts a rule the club has already applied to the finished ones, and inventing a
  separate "provisional is not results" rule six weeks out is a committee decision nobody has
  asked for.
- **It costs nothing to reverse in the direction of more openness**, which is why it is the
  safe way round. Opening the leaderboard later is a grant and a policy; closing one that
  spectators have already used is a thing people notice and complain about.
- **#204 is smaller**, not larger. It reads through a function behind an existing permission
  and needs no anonymous policy, no rate limiting of its own and no argument about what a
  spectator may infer from a partial field.
- **It is consistent with `/timing` being 404 to the public** since 11 September 2026, and with
  [ADR-036](adr-036-timing-staff-are-identity-permissions.md)'s premise that timing is a staff
  application. A public leaderboard would have been the one anonymous surface in it.
- **The Durable Objects slice is still the one ADR-034 cuts if the simulation fails**, and this
  record does not change that. It changes who is watching when it runs.
- **`phases.md`'s "Known work beyond a straight port" row is updated in the same change**, and
  `CLAUDE.md`'s `/nn/<year>/results/` line already says *"until published"* and stays right.

## Exit cost

**Low, and asymmetric.** Making the leaderboard public later is one grant, one policy and one
address — the read function already exists and the transport does not care who is connected.
Making a public one private later is a withdrawal of something people have used. The cheap
direction is the one this record takes.

## Revisit when

- **After 1 November 2026**, on the club's own initiative rather than an agent's: whether the
  2027 race gets a spectator screen is a question worth asking once there is a working
  leaderboard to point at.
- **If the club asks for a projected screen at the finish** — option 3 of the three #255 set
  out, a page a volunteer signs in to and shows on a laptop. That needs no new decision: it is
  this record's leaderboard on a volunteer's session, and it is the cheapest way to give
  spectators most of what they lost.
- **If the results rule itself changes** — if the club decides provisional results may be
  public before publication, this record goes with it, because its whole argument is
  consistency with a rule that would no longer hold.
