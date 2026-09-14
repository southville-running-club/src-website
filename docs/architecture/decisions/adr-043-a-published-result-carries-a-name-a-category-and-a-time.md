# ADR-043 — A published result carries a name, a category and a time, and the exact age stays behind publication

**Accepted**, 14 September 2026. **Supersedes** one consequence of
[ADR-042](adr-042-publishing-a-result-is-an-act-somebody-takes.md) — *"the first `anon` grant in
`timing`, **and the only one**"* — and nothing else in it. The decision that record took, the
state machine it built and the three properties it rests on all stand.

|                 |                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Requirement** | [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully)                                           |
| **Issue**       | [#242](https://github.com/southville-running-club/src-website/issues/242), rung 4 of [#257](https://github.com/southville-running-club/src-website/issues/257)                                                      |
| **Supersedes**  | One consequence sentence of ADR-042. A second `anon`-callable function exists now, argued below                                                                                                                    |

## Context

**#241 moved a boundary and nothing on a page moved with it.** `timing.results_for_event()`
became callable by `anon` once a race is published — the schema's first such grant, argued at
length. What that grant opens is the **payload**, and the payload carries, per named runner,
`firstname`, `lastname`, `gender` and **`age_on_day`**: an exact age on race day.

`/nn/<year>/results/` renders a category and no age at all. So nothing about looking at the page
would have revealed it, which is precisely what made it easy to miss — and it was missed by the
migration's own header, which argues the grant is safe partly because *"the answer's shape is
unchanged — no email address, no club"*. True, and a claim about the two columns somebody thought
to leave out rather than about the one left in. The review on
[#284](https://github.com/southville-running-club/src-website/pull/284) caught it and asked #242
to settle it, in those terms: *"I'd rather it were a sentence somebody wrote down than a thing
nobody noticed."*

**The club has already answered the general question.** #242's own definition of done says a
published result carries *a name, a category and a time, which `/nn/privacy/` already says the
club publishes results by* — and that **a field beyond those is the stop-and-ask**. An exact age
beside a full name is a field beyond those. So the work here is applying a decision that exists,
not taking one that does not.

**The second thing this record settles is smaller and arrived with the same issue.** #242 asks
for `/nn/` and `/nn/<year>/` to link to the results **only once they are published**, because a
link to a 404 is a claim about a record. That is a question the Worker has to ask on two pages,
for a signed-out visitor, on every view — and the only function that could answer it returns the
entire field to do so.

## Decision

**1. The exact age is withheld once a race is published.** `results_for_event()` returns
`age_on_day` as `null` for every runner on a published race, and unchanged to the
`nn.results.read` holders who are the only callers before publication.

**Withheld by publication, not by permission**, and the difference is the whole design:

- **Once published, every caller gets the same answer** — a permission holder included. That is
  the only arrangement in which `/nn/<year>/results/` can carry a **public** `Cache-Control`,
  which is what C2's permanent public address is for. A payload that varied by permission on a
  publicly cacheable URL is a cache-poisoning defect waiting to be written.
- **The preview keeps it**, because the preview exists so somebody can check the data before the
  internet reads it, and an age is exactly the sort of thing being checked. A race is unpublished
  while its results are being prepared, and a correction after publication is *unpublish, fix,
  publish* — so the age is in the answer at every moment anybody is working on the data.

**2. The published page therefore shows a race category and not an age band.**
`Women` and `Men` — `effectiveCategory()`'s answer, resolved through `placementFor()` so that
ADR-031's placement decides where a non-binary runner's result counts — and a dash for a runner
the club has no category for. The preview, which has the age, shows the full band the club awards
prizes in: `Women's Vet 50`.

**3. `timing.results_published_at(slug)` is a second `anon`-callable function**, answering one
bit: when this race's results became public, or `null` for a race that is not published and for
one that does not exist. It exists so the two pages that link to the results can ask without
pulling two hundred and fifty teams of payload to decide whether to paint an anchor.

**4. `result_placement` and `role` join each runner in the answer**, which is the opposite
direction and is not a widening: neither is rendered as a fact about anybody. `result_placement`
is what stops every non-binary runner rendering as *no category* whatever they asked for, and
`role` is what keeps a visually impaired runner's guide out of a prize band —
[ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md), which `awards.ts` already honours
because it is handed the column.

## Consequences

- ⚠️ **A band on a published page is now a decision the club has to take, and it is open.** The
  three ways it could go were set out on #242 and none is free:

  |                                       |                                                                                                                                                                                                                     |
  | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Publish the exact age                 | A field beyond the name, category and time the club publishes a result by, and therefore the committee's call rather than a build one                                                                                |
  | Derive the band in SQL                | Names `40`, `50`, `60` and `18` a second time. `CLAUDE.md` is explicit that `packages/shared/src/age-category.ts` is the only thing allowed to name a band, and it would be a seventh instance of the pattern #175 tracks |
  | Publish the category without the band | What is built. The published table loses the four prize bands; nothing else changes                                                                                                                                 |

  The third is the conservative direction and the only one that needs nobody's permission, so it
  is what ships. **If the club wants the bands on the published table, that is one of the first
  two, and it is a sentence somebody has to write down** — the same request that reaches
  [#205](https://github.com/southville-running-club/src-website/issues/205), whose prize screens
  work on unpublished races and are unaffected either way.

- **The staff preview and the published page are no longer the same table**, and that is an
  honest asymmetry rather than a gap: the preview has always shown more than the public page —
  it exists before there *is* a public page — and what it shows extra is the band, which is
  derived from data the club holds and does not publish.

- ⚠️ **A response that sets a cookie is never publicly cached**, whatever the race's state.
  `readSession()` rotates a refresh token the moment the access token is close to expiry, so a
  published page served to a signed-in visitor can carry `Set-Cookie` — and a shared cache
  storing that would hand one person's refreshed session to the next. The Worker falls back to
  `private, no-store` on exactly that request, and a crawler, which carries no cookies, never
  reaches the branch.

- **Publicly cacheable means a withdrawal is not instant.** ADR-042's correction path takes the
  page back to 404 while the data is fixed, and a cache that already holds the table will go on
  serving it until it expires. The lifetime is **sixty seconds** for that reason, chosen against
  the withdrawal rather than against the load: the page is cheap, the Worker runs on every
  request anyway, and a minute is the longest anybody should be reading a table the club has
  withdrawn.

- **A third `anon`-callable function in `timing` is still a decision somebody takes in a diff.**
  `packages/db/tests/timing.test.ts` pins the granted list by name and by grantee, which is the
  mechanism ADR-042 relied on and this record leaves in place — what changed is the number, not
  the rule.

- **`apps/main/worker/nn-results.ts` stopped casting a payload it did not have.**
  `packages/shared/src/timing/rows.ts` has declared `result_placement` and `role` on
  `TimingRunner` since #202 and the answer did not carry them, which compiled only because the
  cast is `as unknown as`. That is the mismatch `rows.ts`'s own header warns about in as many
  words.

## Alternatives considered

**Accept the exact age and record it in the migration header.** The option #284's review listed
first, and the one that lets the published page show a band today. Rejected because it publishes
a field the club's own definition of done puts on the stop-and-ask list, and *personal data is
minimised at the boundary* is a non-negotiable — an agent widening it in passing is exactly the
shape of thing that rule exists to prevent. It remains available the moment somebody with the
authority says so, and it is one `case` expression away.

**Return the band from SQL instead of the age.** Keeps the page whole and duplicates the club's
prize bands into a second place. `CLAUDE.md` names `age-category.ts` as the only thing allowed to
name a band, and [#175](https://github.com/southville-running-club/src-website/issues/175) is an
open issue tracking six instances of exactly this kind of re-implementation. The prize list
drifting from the entry form is the failure it would invite, and it is discovered at a prize
giving.

**Withhold the age from `anon` rather than from a published race.** One predicate on the
permission instead of on the state, and it leaves the staff preview untouched after publication.
Rejected because it makes the published page's bytes depend on who is asking, which forbids the
public `Cache-Control` #242 asks for — or, worse, invites somebody to send it anyway.

**Paint the results link from `results_for_event()` itself.** No new function, and it answers the
question by returning every team, every runner and every crossing of a two-hundred-and-fifty
runner field to decide whether to render one anchor, on `/nn/` and `/nn/<year>/`, on every view.

**Link the results unconditionally and let the page 404.** Free, and it is a claim about a record:
a link on the club's own front door saying a race's results exist, answering "there is nothing at
this address" to everybody who follows it.

## Exit cost

**Low, in both directions.** Publishing the age again is deleting a `case` expression and the
assertion that pins it. Dropping `results_published_at()` is one `drop function` and un-painting
two anchors.

## Revisit when

- **The club decides whether an age band may be published.** The whole of consequence one, and
  the only part of this record that is waiting on somebody.
- **A published result needs a field this list does not have** — a chip time beside a gun time,
  a club name, a finishing position in a band. Each is a field beyond a name, a category and a
  time, and each is the same stop-and-ask this record applied rather than answered.
- **Something other than a link needs to know whether a race is published.** Two callers of
  `results_published_at()` is fine; a fourth `anon` function to answer a variation of the same
  question means the answer wanted a shape rather than a bit.
