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

## Amendment, 10 October 2026: the admin half

§4 said fixing names and bibs and adding on-the-day runners would arrive later. It has. Admins
change the Roster from the page itself:

- **Edit**, a link on each row, opens a panel to correct the runner's name and bib. For somebody
  holding `timing.event.manage` it also sets Normal, DNS, DNF or DQ, with help text that
  matches what is chosen.
- **Add runner** takes an on-the-day entry: a name, how they want to be placed, an optional age
  (never a date of birth) and the spare bib being handed over. Left blank, the bib is the next
  unused number.
- Both post to `roster/update`, behind **`timing.registration.import`**, the entry list's own
  permission. A marshal is refused there, as at every other write.

One new database function, **`timing.rename_runner()`**:
- It is a compare-and-swap on the name the form was drawn with. Two desks correcting the same
  runner is the normal case, so the second is told "changed on another device" rather than
  overwriting the first.
- It is audited without copying the old or new name into `admin_actions`.

Everything else reuses functions that existed:
- `set_bib_override()` refuses a bib somebody else holds. The page names who holds it, looked up
  from the roster it has already read, so no name travels in the address.
- `add_walk_in()` creates the runner, with the next free number.
- `set_race_status()` sets the status.

**What the desk spec asked for that this does not do:**
- **A reason with a DQ**: `set_race_status()` takes none.
- **Swapping two runners' bibs in one save.**
- **Marking a runner as an on-the-day entry**: no column records where an entry came from.

Each would be a new function, and none was asked for in this change.
