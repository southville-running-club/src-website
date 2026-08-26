# ADR-016 — `registered` is the role an account gets, and `member` means membership

**Accepted**, 26 August 2026. **Supersedes one row of**
[ADR-015](adr-015-member-accounts-on-supabase-auth.md) — its *Roles* line, which named the three
as `super-admin`, `nn-admin` and `member`. Everything else ADR-015 decided stands, including the
part this record leans on hardest: that **an account is a person, and membership is a later,
separate thing.**

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff), [C12](../../foundations/requirements.md#c12--maintain-membership-records) |
| **Supersedes** | [ADR-015](adr-015-member-accounts-on-supabase-auth.md), in part |

## Context

ADR-015 gave every account a role called `member`, described in the schema as *"Held by everyone
with an account. Grants nothing on its own."*

**At a running club, that is not what the word means.** A member is somebody the club has
recorded as current — joined, paid, not lapsed, on the England Athletics register.
[C12](../../foundations/requirements.md#c12--maintain-membership-records) is explicit that this
is a question the platform must be able to answer, that the authoritative record currently lives
in EA's portal rather than here, and that membership confers real things: the WhatsApp community
and the discount scheme.

So the role that meant *nothing more than having signed up* was holding the one word the club
will need for the thing that matters.

**The repository already knew, and worked around it rather than fixing it.** ADR-015's own
decision table says in one row that the roles are three including `member`, and in the next that
*"This ADR creates nobody's membership record."* The glossary went further and gave the word a
disclaimer:

> **Member** — *in the accounts sense*, the default role held by anyone with an account who is
> neither `super-admin` nor `nn-admin`. **Not yet the same thing as a club member on the EA
> register.**

**A word that needs a qualifier every time it is used is the wrong word.** The qualifier was
doing real work — without it the sentence is false — and it would have had to keep doing that
work in every document, every test name and every conversation, until somebody eventually
dropped it in the one place it mattered.

## Decision

**The role granted on sign-up is `registered`.** It says what actually happened: somebody
registered. It grants nothing, exactly as its predecessor granted nothing.

**`member` is removed from `identity.roles` entirely, not kept as a spare.**

That second half is the part worth arguing. Leaving a grantable `member` in the enum would let a
`super-admin` record a claim the system cannot back — that somebody has paid and is current —
with no join date, no lapse date, and no link to the EA register. It would be a membership
record in everything but substance, created by a dropdown. When membership is built it will
bring its own record and its own migration, and that migration is what should create the word.

| | |
| --- | --- |
| **Roles** | Three, and no more: `super-admin`, `nn-admin`, `registered` |
| **Granted on sign-up** | `registered`, by `identity.handle_new_user()`, unconditionally |
| **Grantable at `/admin/people/`** | `super-admin` and `nn-admin`. Not `registered` — every account has it and it opens nothing, so a control for it would be a button that does nothing |
| **`member`** | Not a role. Reserved for [C12](../../foundations/requirements.md#c12--maintain-membership-records) |

## Consequences

**The migration is a rename, and it is cheap exactly once.** It widens the check constraint,
moves every grant, replaces the signup trigger, then narrows the constraint again and deletes
the old row — one migration rather than an expand and a contract across two deploys.

That works because of a window that is about to close. Narrowing a check constraint does not
keep previously deployed code working in the general case: a Worker still offering `member` in
`admin-people.ts` would fail if somebody used it. **Nobody can reach that path today** —
`/admin/people/` needs `super-admin`, and `admin@southvillerunningclub.co.uk` has not registered
yet, so `identity.grant_role()` is unreachable by every actual caller. **The moment the
super-admin registers, this becomes a two-deploy change with rows to migrate.** Doing it now is
worth more than doing it tidily later.

**`identity.audit` is not rewritten.** Its `detail` column records what was granted at the time,
and a grant of `member` in August was a grant of `member`. An audit trail is not tidied up — the
same reasoning `entries.admin_audit` carries, and the reason `role_grants` revokes rather than
deletes.

**Nothing about access changes.** `member` appeared in no row-level security policy and no
`identity.has_role()` check; it was purely a label. `STAFF_ROLES` is unchanged, `/admin/`'s 404
rule is unchanged, and somebody holding only this role can do exactly what they could before,
which is sign in and read their own profile.

**One word gets easier to use.** "Member" can now mean what the club means by it, in the
glossary, in the requirements, and in whatever builds C12 — with no qualifier and no footnote.

## What this does not decide

**How membership works.** Not the record, not where it is authoritative, not how a lapse is
detected, not whether the platform reads EA's portal or mirrors it. C12 is untouched, and this
record deliberately creates nothing it will need — it only stops something else standing in its
place.
