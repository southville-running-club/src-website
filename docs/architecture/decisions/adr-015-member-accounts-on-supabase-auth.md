# ADR-015 — Member accounts on Supabase Auth, a fifth schema, and two named costs

**Accepted**, 24 August 2026. Extends
[ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), which already named this ADR's
answer as *"the one to reach for the day the platform genuinely has members."* Implements
[decision 005](../../decisions/decision-log.md#005--give-the-platform-member-accounts-on-supabase-auth).

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [people](../../foundations/requirements.md#people) |
| **Supersedes** | No ADR. It extends ADR-013 rather than replacing it — the two-key scheme stays available as a break-glass path until [#63](https://github.com/southville-running-club/src-website/issues/63) retires it |

## Context

**Nothing in this platform signs in.** The one surface that reads people — `/nn/admin` — is
opened by two shared keys, described in full in ADR-013, because nothing built before it had
member-facing authentication to build against. ADR-013 named its own successor in as many
words and refused to build it early, on the reasoning that RLS-by-role would give up *"the
grant-free schema, which is the property everything else here rests on"* while `entries` had no
members to authenticate.

That reasoning no longer holds the schema it was written to protect. Entries want to open in
early September, and the club wants a way to grant somebody `nn-admin` — or, later, to give a
member their own account — that is not a Worker secret typed into a runbook. The organising
question, carried by [`principles.md`](../principles.md#stop-and-ask) as a stop-and-ask since
the skeleton, is: **does the website need member-facing authentication at all?** The answer,
settled in conversation on 24 August 2026, is yes.

## Decision

**Supabase Auth (GoTrue)**, already running locally, configured, and holding zero users.

| | |
| --- | --- |
| **Ways in** | Email and password, Google OAuth, and a magic link. All three, because [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) asks for staff auth *"without passwords to distribute or lose,"* and a password is still the fastest way in for a member at a laptop |
| **Roles** | Three, and no more: `super-admin`, `nn-admin`, `member`. A fourth is a migration and a decision, not a config change |
| **Super-admin** | `admin@southvillerunningclub.co.uk`, bootstrapped by migration. It becomes `super-admin` by registering like anybody else — no seeded password, no out-of-band credential |
| **Schema** | A new schema, `identity` — the person record, the role, and nothing club-specific |
| **Surfaces** | `/account/` for a member; `/admin/` for staff, with its own navigation |
| **An account is a person** | Membership ([C12](../../foundations/requirements.md#c12--maintain-membership-records)) — who is a member, when they joined, whether they lapse — stays a later, separate thing. This ADR creates nobody's membership record |
| **Bot defence** | Cloudflare Turnstile on every unauthenticated account form |

### Why `identity` rather than `club`

[ADR-002](adr-002-schema-layout.md) drew the line this repeats: *"the schema boundary is the
blast radius."* Today's project already carries five schemas — `public` and `private` for the
timing platform, `club` (unexposed, holding the future membership list), `intake`, and
`entries` — and `club` was kept unexposed to PostgREST specifically so that a wrong grant on
one of its tables would still have no route out. Putting a profile in `club` means exposing
`club`, and the membership list along with it, the day member accounts land rather than the
day membership itself does.

A profile has to be readable by its owner through PostgREST, so its schema has to be exposed.
`identity` is that schema — exposed, and holding only what an account needs — while `club`
stays exactly as unexposed as ADR-002 left it. The same argument, applied a third time.

## Three costs this knowingly accepts

### The account area will require JavaScript

Turnstile has no no-script mode. [Progressive enhancement, not
JavaScript-dependence](../principles.md#progressive-enhancement-not-javascript-dependence) has
held everywhere on this platform until now — a real `<form method="post">` that works with
scripting off, because the platform's own users are *"runners and marshals on phones, on poor
mobile signal, sometimes in bright sunlight with cold hands."*

`/account/sign-up/`, `/account/sign-in/`, and the two password-reset addresses are the first
pages on this platform where that stops being true. This is accepted rather than worked
around: a bot-defended sign-up is worth more here than a script-free one, and the alternative —
no bot defence on a form that creates a Supabase Auth account — is the worse trade. Nothing
else on the platform gains this exception; the entry and interest forms keep working with
scripting off exactly as they do today.

### `SameSite=Strict` stops being available

ADR-013 refused a CSRF token on `/nn/admin` because nothing links to it, so `Strict` cost
nothing — no email, no cross-site navigation, ever lands there. A magic link and an OAuth
callback are both cross-site top-level navigations by construction: an email client or Google's
own redirect is the origin making the request. `Strict` drops the session cookie on exactly
that request, which breaks the sign-in it is meant to complete.

So the session cookie moves to `Lax`, and the paragraph ADR-013 flagged for exactly this
moment — *"a token becomes worth its machinery the moment a `POST` can alter a record somebody
paid for"* — is now live. `Lax` still withholds the cookie from a cross-site `POST`, which is
where a forged request would need to land; the residual gap is a cross-site **navigation**
that lands on a state-changing `GET`, which the account and admin surfaces do not have. Whether
a CSRF token is warranted once a `POST` on this platform can edit a paid record — refunds,
transfers, corrections — is [#63](https://github.com/southville-running-club/src-website/issues/63)'s
question to answer, not this one's.

### The `[auth]` block stops being inert

`packages/db/supabase/config.toml`'s `[auth]` block has shipped to production, via
`deploy-db.yml`'s `supabase config push`, on every merge touching a migration since the
skeleton — with `enable_signup = false` making the whole block a no-op. [#49](https://github.com/southville-running-club/src-website/issues/49)
turns that switch on; this ADR is what makes turning it on a decision rather than a surprise.
Nothing about the deploy step changes — what changes is that the block it has always sent stops
being dead weight.

## What the alternatives lose

### Keep the two-key scheme, and add more keys

Every new role is a new Worker secret and a runbook step. It cannot express *"this person may
read entries but not grant roles"* — ADR-013's scheme is binary, admin or not — and it can
never be self-service: granting `nn-admin` today needs a person with database credentials to
run an `update`, which is exactly the resilience gap [#59](https://github.com/southville-running-club/src-website/issues/59)
exists to close.

### Cloudflare Access in front of the routes

ADR-013 called this *"the best answer to identity on this list"* and refused it on
testability: no Access in Miniflare and none on a laptop, so every test would run down a
bypass path. That is still true, and it is why this ADR does not choose it either — but the
two compose rather than compete. Access in front and Supabase Auth behind is a real option the
day somebody is at the Zero Trust dashboard anyway; nothing here forecloses it.

### Roll our own accounts

Password hashing, reset tokens, OAuth callbacks, rate limiting, and session rotation,
maintained by two volunteers with day jobs. Fails *boring beats optimal* by the widest margin
available on this page, and every one of those primitives is exactly the kind of thing a
free, managed identity provider exists to remove from a small team's list.

## Consequences

**The grant-free property `entries` has held since its first migration does not change.** This
ADR adds a schema; it does not touch `entries`'s own grants, which stay exactly what ADR-013
left them. `identity` is a new, separate exposure, with its own RLS from its first migration —
the platform's standing rule, not a new one for this ADR to state.

**The two-key admin scheme stays live.** [#57](https://github.com/southville-running-club/src-website/issues/57)
adds a role-gated path into `/nn/admin` *beside* the Worker-secret path, not instead of it —
so if the role path is not ready by early September, installing the two keys per
[the runbook](../../delivery/runbooks/entries-admin.md) is still the break-glass, exactly as
ADR-013 built it to be. [#63](https://github.com/southville-running-club/src-website/issues/63)
retires it later, after race day and after the change freeze lifts — a contract, not a task on
this page's list.

**Seventeen further issues build on this one**, tracked in
[#65](https://github.com/southville-running-club/src-website/issues/65), which also carries
the ordering: nothing in that series may start until this ADR and its decision-log entry are
merged.

## Exit cost

**Low for the data** — `identity` is a standard Postgres schema and exports like any other.
**Moderate for the mechanism** — leaving Supabase Auth means re-issuing every session, and
re-registering every account against whatever replaces it; Google and magic-link sign-in would
need rebuilding against a new provider's callback shape. Turnstile is the cheapest piece to
exit: a single client-side call, swapped for another provider or removed outright.

## Revisit when

Supabase Auth's free-tier terms change around emails sent per hour or accounts held; a fourth
role is proposed; or [#63](https://github.com/southville-running-club/src-website/issues/63)
retires the two-key scheme, at which point `Lax` and the CSRF question this ADR deferred are
worth a fresh look with a single door rather than two.
