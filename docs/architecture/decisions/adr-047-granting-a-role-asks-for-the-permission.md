# ADR-047 — Granting a role asks for the permission, not for the role

**Accepted**, 19 September 2026. **Resolves** the question
[ADR-046](adr-046-roles-are-saved-as-a-batch.md) recorded as open under _"What this leaves
open"_, and **completes** the migration
[ADR-017](adr-017-permissions-are-what-code-checks.md) described and did not finish.

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) |
| **Resolves** | ADR-046's open question about who may change a role |
| **Completes** | ADR-017 — `grant_role()` and `revoke_role()` were the last two gates still asking a role |

## Context

**This was a defect rather than a design, and the record already said so.**

ADR-017 made a role a bundle of permissions and code check the permission. #107 moved the gates
on this surface accordingly. `20260826190000` moved one more and wrote this in its own header:

> `identity.list_people()` was still asking a role, and that is a defect ADR-017 missed. Every
> other gate on this surface moved to `identity.has_permission()` in #107. This one did not —
> it still reads `identity.has_role('super-admin')`, which is the fifth string comparison
> ADR-017 counted and then left behind. **Moving it is not a favour to the new role; it is the
> last of the migration ADR-017 described.**

**It was not the last.** `grant_role()` and `revoke_role()` were never moved, and
`set_roles()` was written to match them in ADR-046 precisely so the batch path and the single
path could not disagree about who may act.

### What made it visible

On 6 September 2026 the club created **`src-admin`**, its master role for directors, and gave it
`identity.role.grant` among eighteen permissions. Its published description — the one
`/admin/people/`'s own legend renders — ends _"and granting roles"_.

**None of that worked.** The page renders its controls on the permission, so a director saw
every switch and every button; the three functions ask the role, so every press was refused with
_"You are no longer a super-admin, so that change was not made."_

**Nothing looks wrong to a `super-admin`**, which is the whole reason it survived a fortnight:
the two people most likely to open that page both hold the role the database was asking for.

## Decision

**`identity.grant_role()`, `identity.revoke_role()` and `identity.set_roles()` ask
`identity.has_permission('identity.role.grant')`.**

Nothing else changes. Same signatures, same bodies, same audit writes, same refusal codes.

### This is not a new decision about who may change roles

The club took that decision in `20260906100000`, when it put `identity.role.grant` on
`src-admin` and wrote the capability into the role's description. **The database simply never
honoured it.** This migration is the catching-up.

That distinction is the reason this is an ADR rather than a stop-and-ask taken quietly:
CLAUDE.md lists _"changing who is allowed to change roles"_ as a decision somebody must take,
and what the record shows is that it was taken, in a reviewed diff, and then not implemented.

### It grants no capability that was not already held

| Role | Permissions |
| --- | --- |
| `super-admin` | `identity.person.read`, `identity.role.grant` — **two** |
| `src-admin` | both of those, **plus sixteen more** |

`super-admin` is a **strict subset** of `src-admin`. So the obvious worry — that a director
could now make themselves a super-admin and gain something — does not arise: there is nothing
there to gain. Granting somebody *else* `super-admin` likewise hands them strictly less than
granting them `src-admin`, which a director can now also do.

⚠️ **What does change is what a director can _do_.** Before this they could grant nothing at
all. That is the point of the change rather than a side effect of it, and it is what the role
was created to carry.

## Consequences

**A club director can grant and revoke roles**, from the page that has always offered them the
controls.

**`people-admin` and a plain account are refused exactly as before**, and the existing
assertions in `identity.test.ts` and `identity-permissions.test.ts` did not need editing —
neither holds `identity.role.grant`. That is the check that this widened the gate by exactly one
role and not by accident.

**The refusal's wording changed**, because it named the wrong thing: _"You are no longer a
super-admin"_ was the sentence a director met while holding a role whose description says it
grants roles. It is about the capability now.

**The test that pinned the defect now asserts the fix.** `identity-set-roles.test.ts` carried an
assertion that an `src-admin` was refused, written explicitly so that resolving this had to be a
diff somebody wrote on purpose. This is that diff, and the assertion is the other way round.

### ⚠️ The last-super-admin guard is left as it is, and is now slightly over-strict

`revoke_role()` still refuses to remove the last active `super-admin` grant. Its argument was
that a club with no super-admin has no service-role key to get back in with — and that is
**less true than it was**, because an `src-admin` can now grant one.

**Left alone deliberately.** It is over-strict in the safe direction, and the alternative —
a guard on "the last person who can grant anything" — is a different guard with a different
failure mode, and one that has to reason about two roles rather than count one. That is a
decision somebody should take on purpose rather than inherit from this migration.

It is also **not asserted in `identity-set-roles.test.ts`**, and that is deliberate: it is a
claim about the whole database, `vitest.config.ts` records what happened the last time two files
made one, and that file holds two super-admins while it runs. It stays `identity.test.ts`'s.

### What is still open

**Nothing about `/admin/people/`'s masthead**, which ADR-046 deferred and this does not touch.

**Whether `super-admin` should still exist as a separate role** is a fair question that this
does not answer. It now carries a strict subset of `src-admin`'s permissions and differs from it
only in name and in the last-holder guard. Merging them is a decision about the club's
vocabulary, not about this gate.
