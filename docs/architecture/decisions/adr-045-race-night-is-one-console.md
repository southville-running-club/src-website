# ADR-045 — Race night is one console, and its door is wider than its sections

**Accepted**, 14 September 2026. **Supersedes nothing.** It narrows one property of
[ADR-036](adr-036-timing-staff-are-identity-permissions.md)'s model — that every address demands
exactly one permission — without changing what that model protects.

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) |
| **Issue** | [#308](https://github.com/southville-running-club/src-website/issues/308) |
| **Supersedes** | Nothing. ADR-036's permissions, ADR-037's runtime and ADR-044's two not-found statuses all stand |

## Context

**The finding is a volunteer's, and it came from the only end-to-end run of a race anybody has
done.** On 14 September 2026 a timing admin set up `nn-2026` on production, imported the entry
list, started the race, captured crossings on a phone, resolved anomalies, finished it, read the
preview and wiped it. The platform worked. What they said afterwards was:

> _"It all seemed relatively smooth. There were just far too many sub-pages than was needed."_

One race had a hub and **eleven** sections beneath it. On a laptop at race control that is eleven
addresses to hold in your head, and the ones needed most — start, finish, status — are three
separate pages carrying one button each.

**What made it actionable rather than a matter of taste** is that the eleven were far fewer
permissions than addresses. Five of them demanded exactly `timing.event.manage`; two more
demanded `timing.crossing.resolve`; two more demanded `timing.result.publish`. Merging within a
permission changes nothing about who may do what.

## Decision

**Five pages become `/timing/events/<slug>/console`** — `start`, `finish` and `status`, which are
race state, and `anomalies` and `crossings`, which are captures. **`prizes` becomes a section of
`results`.** Twelve addresses become six.

**The console's door demands `timing.event.manage` _or_ `timing.crossing.resolve`**, and the page
renders only the sections the viewer's own permissions open.

### ⚠️ This is the first address here whose door is wider than any section behind it

That is the part worth recording, because it is a departure. Every other address in
`lib/access.ts` demands exactly what the work behind it demands. A page merging race-state work
with capture work cannot: demanding `event.manage` shuts out somebody who may only triage, and
demanding both would need an `and` the file deliberately does not have —
`TimingSurface.permission` says a list is `or` and never `and`, and that an address wanting two at
once is _"a different field rather than a different reading of this one"_.

**Three things keep the wider door honest, and all three are asserted:**

1. **Sections are drawn per permission.** `readPermissions()` says what this viewer holds. Somebody
   with `crossing.resolve` alone sees triage and the log and **no start button** — because the old
   application's defining bug was a nav tab that 403'd whoever tapped it, and a merged page is
   exactly where that bug comes back.
2. **No write moved.** Every form still posts to the address it always did — `start/update`,
   `finish/update`, `status/update`, `anomalies/update`, `crossings/update`, `prizes/export` — each
   still carrying its own permission, enforced at the same door. A forged POST to a section the
   page did not draw is refused exactly as before.
3. **The database refuses anyway.** Every `timing` function re-checks with
   `identity.has_permission()` against `auth.uid()`.

**So the conditional render is navigation and never protection.** `access.test.ts` asserts that
the console admits `event.manage` alone, `crossing.resolve` alone and both — and that it admits
neither `timing-marshal` nor `nn-admin` nor a signed-in account holding nothing. **Widening a door
must not widen it to somebody new**, and that is the assertion which proves it did not.

### The hub predicted this

`app/events/[slug]/page.tsx` linked its sections unconditionally and said why: _"`canOpen()` …
needs the viewer's permissions, which this page does not read — the door does … **if the two
permissions ever come apart in practice, this is the line that has to learn to ask**."_ They come
apart here. Reading permissions in a page is therefore the answer that was already written down,
rather than a new pattern — and it is still not a refusal, which ADR-044 and
[#243](https://github.com/southville-running-club/src-website/issues/243) establish a page here
provably cannot perform.

## Consequences

**The old addresses redirect rather than 404**, from `next.config.ts` so they run before
middleware. They are `permanent: false` deliberately: this is a navigation decision taken six
weeks before a race and the reversible form is the honest one until it has been used on a start
line. Revisit after 1 November 2026.

⚠️ **The console is a long page**, and that is the cost. Five sections stacked vertically is
fewer clicks and more scrolling, which on a phone at a finish line is not self-evidently better.
The sections are `<details>` — CSS only, because every acceptance spec here runs in a
`no-javascript` project — with **Start and Finish open by default** and the rest closed, the
timing log being hundreds of rows on a real race.

⚠️ **Which section is open is decided by the URL, not remembered.** A route handler redirects back
with `?section=…&outcome=…#…` and that section opens, so the message about what just happened is
not hidden inside a collapsed block. The cost is that any _other_ section somebody had opened
closes on every submit. That trade is taken deliberately: a result you cannot see reads as a
button that did nothing, and on a race night that is the more expensive mistake.

**Two searches needed renaming.** Race status and the timing log both used `?q=`. On one page two
controls of that name are one control wearing two hats — searching a bib in the log would have
filtered the status list, and either "Show everyone" would have cleared both. They are `status_q`
and `log_q`.

**Not done here, and deliberately:** `registration`, `marshals`, `leaderboard` and `danger-zone`
keep their own addresses. The first three are each a single permission nothing else shares, and
**`danger-zone`'s distance is part of its control** — `reset_event()` demands the typed slug of
its own accord, but a wipe button inside a page somebody has open all race is a different risk
from one behind its own address.

## Alternatives

**Merge everything into one console, including registration and the roster.** Rejected: those are
two further permissions, the door would then be four slugs wide, and the argument above — that the
render is navigation rather than protection — gets harder to hold the more the door admits.

**A tabbed console with one section rendered per request.** Rejected: tabs are links, so it is the
same number of addresses with a different shape, and it does not answer the complaint.

**Leave it, and reduce the hub's link list instead.** Rejected. It was tried in the same sitting:
the hub now carries eight links rather than twelve, and that is worth having — but the person
using this was not lost on the hub, they were moving between three pages that hold one button
each.
