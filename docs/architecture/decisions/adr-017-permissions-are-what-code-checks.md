# ADR-017 — A role is a bundle of permissions, and code checks the permission

**Accepted**, 26 August 2026. **Supersedes what is left of one row of**
[ADR-015](adr-015-member-accounts-on-supabase-auth.md) — its decision table names three roles and
treats a role as the unit of authorisation. [ADR-016](adr-016-registered-is-not-a-member.md)
corrected the *name* in that row on the same day; this corrects the *mechanism*, and the two do
not overlap. Everything else ADR-015 decided stands, including the part that matters most:
Supabase Auth holds the account, and there is no API tier.

| | |
| --- | --- |
| **Requirement** | [C12](../../foundations/requirements.md#c12--maintain-membership-records), [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Supersedes** | [ADR-015](adr-015-member-accounts-on-supabase-auth.md), in part |
| **Issue** | [#107](https://github.com/southville-running-club/src-website/issues/107) |

## Context

`identity.roles` shipped in #51 with a check constraint — `slug in (...)` — and a comment that
was right about the thing it cared about:

> Exactly three roles. A fourth is a migration and a decision, enforced by the check constraint
> on slug rather than left to convention.

**The decision half of that is not in dispute and this ADR keeps it.** What is in dispute is
where a role's *meaning* lives.

### The meaning was spread across five places

Today "may read the Nightingale Nightmare entry list" is answered by:

- `identity.has_role('nn-admin')` in `entries.entry_list()`
- the same call in `entries.interest_list()`
- the same call in `entries.entrant_medical()`
- the same call in `entries.export()`
- `viewer.roles.includes('nn-admin')` in `worker/admin.ts`

Five string comparisons against one literal. Granting that same capability to a treasurer, a
results volunteer or a race director means finding all five and adding a second literal beside
each — and the club is going to want those roles, because
[C12](../../foundations/requirements.md#c12--maintain-membership-records) says so.

The cost is not the typing. It is that **the fifth call site somebody misses is a security
hole that looks like a missing feature**: the new role works everywhere except one page, and
whoever reports it will report it as "the export button does nothing".

### The constraint had a second cost nobody had paid yet

It made the role set a property of DDL. So `identity.grant_role()` could not be handed a role
the constraint had not been taught, and adding one meant `ALTER TABLE` on a table under load.
[ADR-016](adr-016-registered-is-not-a-member.md) is the first migration to actually do it, and it
records the narrowing as *"only safe this week"* — safe because nobody has reached the affected
path yet, which is not a property the next change gets to rely on.

## Decision

**A permission is what code checks. A role is a named bundle of permissions and nothing else.**

```
identity.permissions        slug, description      what may be done
identity.role_permissions   role, permission       which roles may do it
identity.has_permission()   the one primitive      what every gate asks
```

Six permissions, seeded so that **nobody's access changes on the day this lands**:

| Role | Permissions |
| --- | --- |
| `super-admin` | `identity.role.grant` |
| `nn-admin` | `nn.entry.read`, `nn.entry.read_medical`, `nn.entry.export`, `nn.entry.cancel` |
| `nn-tester` | `nn.entry.before_open` |

**`super-admin` holds one permission, and that is the seeding decision worth arguing.** The
obvious version gives it everything. It must not, because
[#58](https://github.com/southville-running-club/src-website/pull/58) already decided otherwise
and `tests/worker/admin/admin.test.ts` asserts it — *"a grant is not an inheritance"*. Being the
person who hands roles out is not being the person who may read two hundred entrants' emergency
contacts, and if it were, `/admin/people/` would be a way to give yourself the entry list without
leaving a grant behind. A super-admin who needs it grants themselves `nn-admin`, which writes a
row in `identity.audit`.

The permission names are `area.subject.verb` and the format is enforced by a check constraint on
`identity.permissions.slug`. A vocabulary that drifts into `nnEntryRead`, `read-entries` and
`entries:read` is one nobody can grep, and this table is about to become the language every
authorisation check in the platform is written in.

### The check constraint on `roles.slug` goes; the guard does not

`packages/db/tests/identity-permissions.test.ts` asserts the exact set of roles, the exact set of
permissions, and the exact mapping between them. That is the shape
`packages/db/tests/entries.test.ts` has used since the beginning for the thirteen functions the
anon role may execute, and it exists for the same reason — to make an addition a decision
somebody takes in a diff rather than a side effect.

**The foreign key from `role_grants.role` to `roles.slug` is untouched**, so a role that does not
exist still cannot be granted. What is removed is the requirement that the set be known to DDL.

### `has_role()` stays

Four `entries` functions and the deployed Worker call it, and this repository does not break
previously deployed code. It is still granted, still correct, and removing it is a contraction
for a later pull request once nothing calls it.

### One question stays a role question

`isStaff()` in `worker/admin-shell.ts` still asks about roles. It answers *"is this person
staff"* — a question about the shape of the door rather than about what is behind it — and
`nn-tester` is the case that proves the distinction: it holds a permission and must not be let
into `/admin/` at all. A "holds any permission" test would let it in.

## Consequences

**Adding a role is a migration and nothing else.** `/admin/people/` reads
`identity.grantable_roles()` rather than a hand-written array, so a new role appears on the page
with its description and its permissions the moment the migration lands. The `ROLES` and
`GRANTABLE` constants in `worker/admin-people.ts` are deleted.

**Granting a capability to an existing role is one row.** No deploy, no call-site hunt.

**`/admin/people/` now says what a role means.** The permission list travels with each role, so
granting somebody `nn-tester` is not granting a capability nobody at the keyboard can see.

**Two reads per admin request instead of one.** `my_roles()` and `my_permissions()`, in parallel,
both required to succeed. A viewer built from one and not the other would have navigation and
gates that disagreed.

**The permission column on `entries.fees` has no foreign key**, deliberately.
[ADR-002](adr-002-schema-layout.md)'s rule is that the schema boundary is the blast radius, and a
hard reference would make a permission undroppable because a fee row mentions it. A misspelling
there fails closed: `has_permission()` is false for a word nobody holds, so the fee is invisible
and unbuyable.

### What this does not do

It does not add a permission for anything that was not already possible, except
`nn.entry.before_open` and `nn.entry.cancel`, which [#107](https://github.com/southville-running-club/src-website/issues/107)
and [ADR-018](adr-018-cancelling-an-entry.md) argue on their own terms. It does not introduce
per-event or per-race scoping — every permission here is platform-wide, and the day the club runs
two races with different volunteers is the day to decide whether it needs to be otherwise.
