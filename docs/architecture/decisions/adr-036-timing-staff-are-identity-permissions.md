# ADR-036 — Timing staff are `identity` permissions, and the per-event roster is a grant

**Accepted**, 10 September 2026. **Extends**
[ADR-017](adr-017-permissions-are-what-code-checks.md) to the second application, and
supersedes no ADR — the model it replaces is
[`src-race-timing`](../../reference/timing-app-review.md#auth-and-roles--two-layers)'s, which
this repository never recorded.

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff), [people](../../foundations/requirements.md#people), [convergence](../../foundations/requirements.md#convergence) |
| **Supersedes** | No ADR |

## Context

The old application carries **two layers of authority**: `staff_assignments(user_id, role)` is
the global one, holding `'admin'` or `'marshal'` and read by `proxy.ts` on every gated
request; `marshals(event_id, user_id, …)` is the per-event roster saying whether somebody who
holds the marshal role globally may act on *this* event.

That is a reasonable design and it is a second answer to a question this repository has already
answered. Since ADR-017 a role is a bundle of permissions and **code checks the permission,
never a role name** — six roles, eleven permissions, asserted exactly in
[`identity-permissions.test.ts`](../../../platform/packages/db/tests/identity-permissions.test.ts)
so that adding one is a decision somebody takes in a diff. Carrying `staff_assignments` across
would mean two role tables, two grant paths and two places a volunteer is switched off.

**And the migration is free, because nobody carries over anyway.** `auth.users` is per-project.
Every marshal and admin re-registers against the club's project regardless of what the
authority table looks like, so there is no account to preserve and no reason to preserve the
shape around it.

## Decision

**`identity` is the only authority. The per-event roster survives as a scope, not as a role.**

| | |
| --- | --- |
| **`staff_assignments` is not written** | Its job is `identity.roles` plus `identity.role_permissions`, which exist |
| **`timing.marshals` is written, and means something narrower** | Not *"may this person marshal"* — that is a permission — but *"which events may this person act on"*. A grant, checked **after** the permission, never instead of it |
| **New permissions** | `timing.event.manage`, `timing.crossing.record`, `timing.crossing.resolve`, `timing.registration.import`, `timing.result.publish`, `timing.marshal.assign` |
| **New roles** | `timing-admin` and `timing-marshal`, as bundles of the above |
| **Granting is `/admin/people/`** | It already exists, behind `identity.role.grant`. The old app's `/admin/staff` page is not rebuilt |
| **Onboarding is unchanged in shape** | Sign in first, land with no role, ask an admin. That is what the old app chose after rejecting an invitations table and a service-role pre-create, and it is what `/admin/people/` already does |

⚠️ **This is the stop-and-ask `CLAUDE.md` names, taken here on purpose.** Six roles and eleven
permissions become eight and seventeen, and the count is asserted rather than described — the
change is not real until `identity-permissions.test.ts` says so. **`src-admin` holds its
permissions as explicit rows rather than as a wildcard**, so every one of the six forces a
human to write down whether club directors get it. That recurring cost is the feature.

**A marshal is not staff, and `isStaff()` must keep answering `false` for one.** The door to
`/admin/` is gated on roles and its sections on permissions, and `timing-marshal` belongs on
neither side of that door: race-day capture is its own surface under `/timing/`, gated on
`timing.crossing.record` plus a roster row for the event in the URL. `nn-tester` is the
existing precedent for a role that holds a permission and is not staff.

**Failure is a 404, not a 403**, matching `/admin/`: a 403 discloses that the address exists.

## Consequences

- **Every marshal and admin re-onboards**, once, against the club's Supabase project. This is a
  race-simulation item rather than a footnote — the old app's own logs record that the **true
  two-marshal end-to-end path was never fully verified**, having been blocked by the free
  tier's OTP rate limit, and the rehearsal now has to clear both that and a cold roster.
- **`proxy.ts` is not ported.** The permission is checked per request in the application, the
  way `/admin/` does it, rather than in middleware reading a second table.
- **A permission can be granted without the role**, which is the point of ADR-017 and is
  immediately useful here: somebody may import registrations without being able to resolve
  crossings, and the club can put a volunteer on one event without making them an admin.
- **`identity.grantable_roles()` picks the two new roles up with no deploy**, because
  `/admin/people/` reads it rather than a constant.
- **The RLS policies are written against the permission**, not against a role name, so a
  seventh role cannot silently acquire timing write access.
- **Two authority tables become one, and the old app's second one is not missed** — but the
  *question* it answered is real, which is why the roster survives. Deleting it outright would
  mean anybody holding `timing.crossing.record` could write crossings into any event.

## Exit cost

**Low.** Roles and permissions are rows; adding, removing or re-bundling them is a migration
and no deploy. The irreversible part is not this record — it is that `auth.users` never comes
across from the old project, which is true under any authority model.

## Revisit when

- **The roster proves to be the wrong grain** — for example, if marshals need scoping to a
  position on the course rather than to an event.
- **A seventeenth permission is needed**, which is the same stop-and-ask this record just took.
- **Re-onboarding stalls on the free tier's OTP rate limit**, which would make it an
  infrastructure decision rather than an authorisation one.
