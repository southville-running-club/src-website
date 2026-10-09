# ADR-056: Marshals read the roster

**Status:** Accepted
**Date:** 9 October 2026
**Amends:** [ADR-036](adr-036-timing-staff-are-identity-permissions.md) — `timing-marshal` gains
a second permission. [ADR-055](adr-055-race-timing-follows-pass-the-bucks-navigation.md) said
Roster was admin-only "because nobody has decided a marshal should read the field's names";
this is that decision.

## Context

Pass the Buck's marshals could open its roster. On race day the registration desk and the
people at the line look runners up by name or bib, and in NN a marshal could not read a single
name: every roster read was behind `timing.event.manage` or `timing.registration.import`, an
admin's permissions.

On 9 October 2026 the club decided:
- a marshal's tabs are **Home · Marshal · Roster**;
- on the Roster a marshal **looks up only**: search by name or bib, and see category and
  status;
- admins use the same page and can also fix it.

## Decision

### 1. One new permission: `timing.roster.read`

It opens the Roster page and `timing.desk_roster()`, and nothing else. It is held by
`timing-marshal`, `timing-admin` and `src-admin`, the last as an explicit row like every other.

It is **its own permission rather than an admin one handed down**. `timing.event.manage` would
also let a marshal start, finish and wipe a race, and `timing.registration.import` would let
them import an entry list. ADR-036's shape is one power per permission.

### 2. A marshal reads only the races they marshal

`desk_roster()` checks the race's marshal roster, the same scope as the capture screen
(ADR-036). An admin holding `timing.event.manage` reads any race. Every refusal (no permission,
no such race, not rostered) is the same `null`, rendered as the ordinary not-found page, so a
slug cannot be probed for existence.

### 3. What a marshal is shown

It is one row per runner: **name, status, category and bib**, plus whether the runner is a
guide.
- **No exact age.** The category's age band is computed from an age, and a marshal looking a
  runner up does not need it. So `desk_roster()` returns `age_on_day` only to an admin, and a
  marshal's category reads "Women" or "Men" without the band.
- **No email, club, gender identity, or anything from `entries`.**

The band is still named in exactly one place, `age-category.ts`, rather than restated in SQL.

### 4. Changing anything stays an admin's

Marking DNS, DNF and DQ keeps `timing.event.manage` at the door and in the database, and the
page draws those controls only for somebody holding it. Fixing names and bibs and adding
on-the-day runners is an admin's too, and arrives in a later change.

## Consequences

- **Every rostered marshal can read the names of everybody in their race.** That is the point,
  and it is personal data in more hands than before: an on-course volunteer's phone.
- **`identity-permissions.test.ts` grows to nineteen permissions**, and the timing schema to
  thirty-six granted functions. Each addition was made in a diff, which is what both lists
  exist to force.
