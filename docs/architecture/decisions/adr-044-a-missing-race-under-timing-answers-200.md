# ADR-044 — A missing race under `/timing` answers 200, and a refusal answers 404

**Accepted**, 14 September 2026. **Supersedes nothing.** It records a decision neither
[ADR-036](adr-036-timing-staff-are-identity-permissions.md) nor
[ADR-037](adr-037-timing-stays-on-next-under-opennext.md) took and that the code had been
taking by default.

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) |
| **Issue** | [#291](https://github.com/southville-running-club/src-website/issues/291) |
| **Supersedes** | Nothing. ADR-036's permission model and ADR-037's runtime both stand untouched |

## Context

**`/timing` has two ways of saying "there is nothing here", and until #291 counted them nobody
had noticed they answer with different status codes.**

| | How it refuses | Status |
| --- | --- | --- |
| No session, no permission, or no roster row | `middleware.ts` rewrites to an address matching no route, so Next serves its **prerendered** not-found page | **404** |
| Permission held, and the slug names no race | the request gets past the door, the page's own read answers `none`, and the page renders the not-found body itself | **200** |

**Neither half is an accident.** The 404 is the stronger behaviour and is what a crawler, a
cache and a monitoring check all read. The 200 is what is left once throwing is off the table:
[#243](https://github.com/southville-running-club/src-website/issues/243) measured that
`notFound()` raised during a **dynamic** render — and reading cookies makes every render in
this application dynamic — returns an empty `<html id="__next_error__">` shell with the page
only in the streamed RSC payload. Signed out that produced no `<h1>`, no banner and no footer
in the HTML, and **a blank page with JavaScript off**, which is a whole Playwright project
here. That measurement is the entire reason the door refuses by rewriting rather than by
throwing, and it is the reason a page that has nothing to show *renders* something. A render is
a 200.

**Ten pages take the second path**, and each had a test named *"gives a race that does not exist
the ordinary not-found page"* asserting the heading and **not** the status — so the
inconsistency was uniform and guarded at the wrong level. It surfaced when the live
leaderboard's own copy of that test was written asserting the 404 and failed on all three
engines.

**Making the two agree means the door learning whether the slug names a race, and there is no
cheap way for it to learn that.** The shape exists: `/timing/marshal/<slug>/` is `rosterScoped`,
so the door already calls `timing.marshal_event()`, and **that address already answers 404 for a
race that does not exist** — for nothing, because the read answers ADR-036's roster scope, which
the door has to ask anyway. No event address has a read like that. Buying one would mean:

- **A second database call on every event page view**, on all twelve addresses, forever — a
  strict duplicate of the read the page then makes for itself. It is paid on the 100% of
  requests that name a race that *does* exist, to change the status of the ones that do not.
- **A thirty-sixth granted function in `timing`.** None of the thirty-five answers *"does this
  slug name a race"* at the permission each address actually demands. `event_detail()` is behind
  `timing.event.manage`, so calling it at the door would silently `and` that permission onto
  `/registration/`, `/marshals/`, `/anomalies/`, `/results/` and the rest — which is exactly the
  "code checks the permission" rule [ADR-017](adr-017-permissions-are-what-code-checks.md) makes
  and `lib/access.ts` exists to keep. `timing.results_published_at()` is permission-free and
  answers `null` for an unpublished race as well as a missing one, so it cannot serve either.

**And the two harms #291 names are both smaller than they look.**

- **A cache storing a 200 whose body says "Not found"** for an address that later has a race on
  it. Every page under `/timing` is `force-dynamic`, so the response already forbids being
  stored. That was an inherited framework default and is now a **guarded** property:
  `timing.spec.ts` asserts the `cache-control` on that exact response.
- **The status telling you which refusal you hit.** It does — to somebody who is already signed
  in and already holds a `timing.*` permission, and therefore already knows. Nothing outside the
  club can see the 200 at all: every address under `/timing` is 404 to the signed-out public.
  The property that *does* matter is that the two **bodies** are identical, and that was held by
  nothing but a comment repeated thirteen times — one of which had already drifted.

## Decision

**The two statuses stay as they are, and the difference is written down, guarded and cheap to
revisit.**

1. **A refusal is a 404** — `middleware.ts` rewrites to `/__refused`, unchanged.
2. **A race that does not exist is a 200** carrying the ordinary not-found page, rendered on the
   server, working with scripting off. That is a decision now rather than a residue.
3. **One component renders the body in both cases** —
   `apps/timing/app/not-found-body.tsx`. `app/not-found.tsx` and all thirteen pages that can
   have nothing to show render it, so the wording cannot drift. It already had:
   `app/marshal/<slug>/page.tsx` said *"There is no race at this address."* against the site's
   *"There is nothing at this address."* — unreachable, because the door refuses that case
   first, and still a sentence naming which answer somebody had hit.
4. **Every one of the ten tests asserts the status as well as the heading and the sentence**,
   through one helper, `expectNotFoundPage(page, path, status)`. Nine pass `200`; the marshal
   capture screen passes `404`, because its door already knows.
5. **`middleware.ts`'s header states what the door checks, what it costs per request, and that
   existence is deliberately not among them.**

**The door is not given a third check.** Not now, and the conditions under which it should be
are below rather than left to judgement.

## Consequences

- **The inconsistency is now a written expectation instead of an unasserted accident.** A future
  page's test will be copied from a sibling that says which status it expects — which is what
  the leaderboard's author had no way to copy.
- **The bodies cannot drift apart again**, which is the half of this that was a live disclosure
  risk rather than a theoretical one.
- ⚠️ **A 200 whose body says "Not found" is still a lie to a machine, and this record does not
  pretend otherwise.** What it says is that the club is not buying a database round trip per
  page view to stop telling it, to an audience of people holding staff permissions, on a page
  nothing may cache.
- **Nothing about the permission model changes.** A page still never checks its own permission;
  `lib/access.ts` is still the table and `middleware.ts` still the only enforcement. ADR-036 and
  ADR-037 are untouched, which is why this is a new record rather than an edit to either.
- **`packages/db/tests/timing.test.ts` is untouched** — no function is added, so the pinned
  grant list and the count in its own title stand, and `database.types.ts` needs no
  regeneration.
- **The three pages with no such test — `/crossings/`, `/status/` and `/prizes/` — still have
  none.** They render the same component and behave identically; adding the test is a line each
  and is left to whoever next has one of those pages open, rather than added blind by the change
  that could not run the suite.

## Alternatives considered

**The door reads whether the slug names a race** — #291's own suggestion, and the one this
record declines. It is the right *shape*: one mechanism, one status, `marshal_event()`'s
precedent. It costs a second Supabase call on every event page view and a thirty-sixth granted
function whose permission rule would have to be *"any timing permission"* to avoid narrowing
eleven addresses to `timing.event.manage`. Both of those are real prices for a status code that
only a signed-in volunteer can observe. **Revisit it under the conditions below** — the
implementation is fifteen lines and this record is not an obstacle to it.

**`notFound()` from the page.** The obvious fix, measured not to work here, twice: #243 found
the blank shell and this record found nothing that has changed. It would trade a wrong status
code for a blank page with scripting off, which is strictly worse — a status is read by
machines, and a blank page is read by a volunteer on a start line.

**Redirecting to an address that matches no route**, so the door's own 404 answers the missing
race too. Works without a database call, and rejected because it moves the browser: the address
bar would then show `/timing/__refused` for a missing race and the original slug for a refusal,
which makes the two answers distinguishable by **URL** instead of by status. That is the same
disclosure in a more visible place, and it breaks reload.

**Caching the set of race slugs in the Worker**, so the door can answer existence for nearly
nothing. It builds exactly the failure #291 is worried about rather than removing it: a race
created five minutes ago would 404 until the cache expired, on the morning somebody is setting
up a start line. Boring beats optimal, and a cache invalidation problem is not boring.

**Making the refusal a 200 as well**, so the two agree downwards. It would undo #243's
prerendered-404 property, put a crawlable 200 on every address under `/timing`, and answer 200
to a monitoring check on an address that does not exist. The 404 is the half that is right.

## Exit cost

**None.** No schema, no migration, no dependency: a component, a test helper, and three
documents. Reversing the decision means adding the door's read and flipping nine `200`s to
`404` in one helper call each.

## Revisit when

- **An address under `/timing` becomes readable by somebody outside the club.** ADR-038 keeps
  the leaderboard staff-only for 2026; the day that is reconsidered, a public address answering
  200 to a mistyped slug is a crawler's problem rather than a volunteer's, and the door's read
  is worth buying.
- **Anything is put in front of this Worker that caches HTML.** The guard in `timing.spec.ts`
  goes red first, which is the point of it.
- **The door gains a read it needs anyway on event addresses** — the way `marshal_event()` is
  needed on the capture screen. Then existence comes for free and there is nothing left to
  argue: make it a 404.
- **A `timing` function arrives that answers existence at "any timing permission"** for some
  other reason. That is the thirty-sixth function this record declined to add on its own
  account, and once it exists for a second reason the door should call it.
