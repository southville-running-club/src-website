# ADR-046 — Roles are changed as a batch, and super admin is not in it

**Accepted**, 19 September 2026. **Supersedes** the decision recorded in
`apps/main/worker/admin-people.ts` under the heading _"One deliberate act per grant, and never a
multi-select"_, which was written with #85 and never had an ADR of its own.

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) |
| **Supersedes** | The one-form-per-role decision in `worker/admin-people.ts` |
| **Leaves standing** | [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md) on who may read this surface, and [ADR-017](adr-017-permissions-are-what-code-checks.md) on permissions being what code checks |

## Context

`/admin/people/` was a table with a **Grant** or **Revoke** button per role per person, each its
own `<form method="post">` and its own call to `identity.grant_role()` or
`identity.revoke_role()`. The file argued for that shape in as many words:

> The alternative — checkboxes and one Save — makes granting somebody the entry list a thing
> that happens on the way past, and makes an accidental revoke indistinguishable from a
> deliberate one in the audit trail.

**Both halves of that were right about something, and only the first stopped being true.**

The club now has **nine roles**, eight of them grantable. Handing a new committee member four of
them was four page loads and four separate writes with no transaction around them — and that is
its own hazard rather than a safeguard: the third can fail and leave somebody holding two of the
four they were meant to get, with nothing on screen saying which two. The shape that was meant to
make each change deliberate had become a shape that made a **partial** change invisible.

The second half — about the audit trail — did not stop being true, and nothing here trades it
away.

## Decision

**A person's roles are changed together, in one transaction, by
`identity.set_roles(p_person, p_expected, p_wanted)`.**

**`super-admin` is not in the batch.** It keeps `grant_role()` and `revoke_role()`, one act at a
time, behind a confirmation where the person's name must be typed. `set_roles()` refuses a
payload that so much as names it, with `reserved_role`.

**`registered` is not in the batch either**, for a smaller reason: the signup trigger owns it, it
grants nothing, and `/admin/people/` has never offered a control for it.

### The audit trail is unchanged, and that is the point

`set_roles()` writes **one `identity.audit` row per role changed**, with the same two actions —
`grant_role` and `revoke_role` — that the single-act functions write. A batch of four reads in the
audit trail exactly as four separate acts did: same actor, same subject, same `detail`, same
transaction.

⚠️ **So this migration does not touch `identity.audit`'s `action` check constraint at all**, which
is deliberate and not merely convenient. Widening a restated closed list is the invisible merge
conflict `CLAUDE.md` records against `entries.admin_audit.action`, where two branches each
restated the list and the one applied second silently dropped the other's addition. Reusing the
two existing actions means there is no list to restate.

### The last super admin is protected by the shape rather than by a second guard

Because the batch cannot name `super-admin`, **`set_roles()` cannot reach the state
`revoke_role()`'s last-super-admin guard exists to prevent.** The guard stays exactly where it is
and gains no second copy.

That is the same reasoning `entries.transfer_entry()` had to be taught when it turned out to be
the way round the one-place rule: a second path to an act is a second place the act's rules have
to be stated, and the cheapest fix is for the second path not to reach it.

`identity-set-roles.test.ts` asserts the refusal in both directions — `super-admin` in
`p_wanted`, and `super-admin` in `p_expected` with it absent from `p_wanted`, which is how a batch
would express _"take it away"_.

### Concurrency: an expected set, and the fresh one travels with the refusal

Two volunteers on this page at once is the normal case rather than the edge one — the same thing
the timing triage list concluded. The caller sends the set it **rendered**; a mismatch is refused
`stale` **with the current set attached**, so the page redraws what is actually true instead of
asking somebody to reload and work out what changed.

An expected-set comparison rather than a timestamp column, because the question is _"is this still
what I was looking at"_ and a set answers that directly. A clock answers _"has anything happened
since"_, which is a proxy — and `entries.entry_requests` already chose an owner over a timestamp
for the same reason.

An advisory lock per person closes the window between the check and the writes. Without it two
callers both read the same current set, both pass, and both write, and the partial unique index on
`role_grants` refuses one of them in a way neither asked for.

### Progressive enhancement is the primary path

Every spec in this repository runs in a `no-javascript` project, so the page is complete without
scripting and gains only decoration with it. The selected person, the view, the filter and the
search are query-string state reached by real links and a GET form; the switches are
`<input type="checkbox" role="switch">` styled in CSS; saving is POST → 303 → `?person=…&saved=1`
→ a `role="status"` banner. The super-admin confirmation is **its own address**, and the
`<dialog>` is layered over it rather than replacing it.

## Consequences

**A volunteer granting four roles now presses Save once**, and either all four land or none does.

**Somebody can flip a switch without meaning to**, which is the cost the superseded decision was
avoiding. Three things pay for it: nothing is written until Save, every pending change is named in
the bar above the button with its own undo, and the audit trail still records each role separately
so an accidental revoke is as visible afterwards as it ever was.

**`identity.set_roles()` is a new function granted to `authenticated`.** It authorises inside
itself, like every other function on this surface.

### ⚠️ What this leaves open

**Who may change roles is still two different questions, and they disagree.**
`/admin/people/` renders its controls on the **permission** `identity.role.grant`;
`grant_role()`, `revoke_role()` and now `set_roles()` all ask the **role** `has_role('super-admin')`.
ADR-017's mechanism moved `list_people()` and `grantable_roles()` onto permissions and never moved
these.

The live consequence is that **`src-admin` — the club's master role for directors, whose own
published description ends "and granting roles" — is offered controls that every one of those
three functions refuses**, with the words _"You are no longer a super-admin"_.

**This ADR does not resolve it**, because changing who may change roles is a decision the club
takes rather than a side effect of rebuilding a page. What it does instead is pin the current
refusal in `identity-set-roles.test.ts`, so that resolving it has to be a diff somebody writes on
purpose. Three ways out, in the order they are likely to be right:

1. move the three functions onto `identity.role.grant`, which makes the role's description true;
2. drop `identity.role.grant` from `src-admin`, which makes the page honest;
3. leave it and have the Worker gate on `super-admin`, which makes the page and the database agree
   and leaves the description wrong.

**The masthead is unchanged, and two pieces of the signed-off design are therefore not built:**
`aria-current="page"` on the active navigation link, and the phone header's menu button. Both need
`masthead(viewer)` to know the current address, which is a signature change at every admin
section's call site — a cross-cutting edit to a shared component, landing in a pull request about
one page. Deferred deliberately rather than overlooked.

**A third prize category, and the `identity` granted-function list.** Unrelated to this change but
noticed while making it: `entries.test.ts` and `timing.test.ts` both pin their granted functions by
name so that an addition is a decision somebody takes in a diff. `identity` has no equivalent,
which is why adding `set_roles()` broke no assertion. Worth closing; not widened into this change.
