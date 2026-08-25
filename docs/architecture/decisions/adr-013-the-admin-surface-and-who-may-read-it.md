# ADR-013 — Two credentials open the admin surface: a Worker secret, and a key per person

**Accepted**, 16 August 2026. Extends the shared-key mechanism
[ADR-010](adr-010-webhook-writes-paid.md) established, and the access-control shape from
[ADR-002](adr-002-schema-layout.md).

| | |
| --- | --- |
| **Requirement** | [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [shared ownership](../../foundations/requirements.md#shared-ownership), [people](../../foundations/requirements.md#people) |
| **Supersedes** | No ADR. It records the access decision for the first read path that returns people |

## Context

**Every read this platform has ever done returned a fixed, non-personal shape.**
`entries.entry_state()` answers with configuration; `entries.entry_completion_state()` answers
with one word. Nothing has read a person out of `entries`, and the schema's defining property —
*the anon role holds no grant on any table in it* — has never been under pressure.

The admin surface reads names, clubs, ages, England Athletics numbers, emergency contacts and,
behind a deliberate act, medical notes. So the access model had to be settled before a line of
it was written, and the constraint that decides everything is one sentence:

> **Every request this platform makes to Postgres carries the anon key, and the anon key is
> published in page source.**

There is no second credential. `config.toml`'s `[auth]` block has `enable_signup` off and
nothing here signs in; the service role key never reaches a Worker or this repository; and
ADR-010 already refused the remaining option in as many words — *"inventing one — a second
Postgres role reached with a hand-minted JWT — would be the least boring thing in the
repository, resting on assumptions about a hosted platform that fail silently."*

So an admin read function **must** be granted to `anon`, exactly like the seven before it. The
question is only what makes that grant safe, and who the person on the other end is.

## Decision

**Two credentials, and neither is redundant.**

### `ENTRIES_ADMIN_KEY` — a Worker secret, and the authorisation

It gates every route under `/nn/admin` and travels as `p_key` to every database function behind
them. Its SHA-256 digest lives in `entries.webhook_secrets` under the name `admin`; **the key
itself is never stored anywhere**. It ships **null**, which refuses everything — the same shape
`STRIPE_SECRET_KEY` being unset has, and a real state rather than a placeholder that half works.

**With no key bound the surface does not exist.** `handleNnAdmin` returns `null`, the request
falls through to the static-assets binding, and the binding 404s exactly as it does for an
address nobody has published. That is the deployed state today, and it is what makes an
uninstalled admin surface indistinguishable from an absent one.

### A row in `entries.admin_keys` — the identity

The Worker cannot answer *which human* from a secret it holds itself, and three things need it:

- **§3 of this slice requires an export to record who took it.** With one shared password that
  line is a fiction.
- **Revoking one volunteer must not revoke both.** A lost laptop should be one `update`.
- **Reading somebody's medical notes should have a name against it**, and the name should not be
  "whoever had the password".

So each person is issued their own key, `entries.admin_sign_in()` matches its digest and answers
with a **handle**, and the Worker mints a twelve-hour signed cookie carrying that handle. The
person's key is never stored, cached or put in the cookie.

**The handle is a role, not a person's name** — `membership-secretary`, not `bindal`. It lands
in every audit row, and a name there would be personal data in a table whose whole purpose is to
be kept and read later. The mapping lives in
[the runbook](../../delivery/runbooks/entries-admin.md).

### How they compose

```text
                    ENTRIES_ADMIN_KEY (Worker secret)
                             │
   browser ── POST key ──► Worker ── p_key + p_person_key ──► entries.admin_sign_in()
                             │                                        │
                             │◄──────────── { ok, name } ─────────────┘
                             │
                    Set-Cookie: handle|expiry|HMAC
                             │
   browser ── cookie ────► Worker ── p_key + p_actor ──► entries.admin_entry_list()
```

**The Worker's key is checked first, always.** `entries.admin_key_ok()` runs before a person key
is looked at, before an event is resolved and before a row is read — so the published anon key
cannot be used to test candidate person keys, to enumerate events, or to find out whether an
entrant id names anybody.

**One secret, two uses, kept apart.** The same secret signs the session cookie, under a fixed
label so nothing signed here can be mistaken for anything else. A second Worker secret purely
for signing would be one more thing to install and lose, and no more secure.

### Cross-site request forgery is answered by `SameSite=Strict` and by nothing else

**This is a decision rather than an omission, so it is written down.** There is no CSRF token on
either of the two `POST`s that do anything, and there should not be one.

`SameSite=Strict` means the session cookie is not attached to *any* cross-site request, including
a top-level navigation — so a form on another origin posting to `/nn/admin/export/` arrives
without a session and is answered with the sign-in page. Nothing links to this surface from
anywhere, so the usual cost of `Strict` — a link from an email landing you signed out — is a cost
this surface does not pay.

What that leaves is worth stating plainly. **Both state-changing requests are audited reads
rather than writes to an entry**: the worst a forged one could achieve is an audit row and a
disclosure to a browser the person is already sitting at. Nothing on this surface refunds,
transfers, edits or deletes, and if that ever changes, this paragraph is the one to revisit —
a token becomes worth its machinery the moment a `POST` can alter a record somebody paid for.

The residual risk is a browser that does not implement `SameSite`, which for a surface used by
two volunteers on current browsers is not one worth a hidden-field mechanism, a per-session
secret and the failure mode where a token expires mid-form and somebody loses what they typed.

### Three functions are granted to nobody

`entries.admin_key_ok()` answers one bit — *is this the admin key* — and that bit is the whole of
the surface's security. `entries.record_admin_action()` writes the audit trail, and a forgeable
audit trail is worse than none. Both join `entries.raise_attention()` in being reachable only
from the definer functions that call them.

## What the alternatives lose

### Supabase Auth accounts, with RLS keyed on role

The textbook answer, and the one to reach for the day the platform genuinely has members.

**It loses the grant-free schema, which is the property everything else here rests on.** RLS by
role means `select` grants and `select` policies on the entries tables — reversing both *"has no
policies at all"* and *"gives the anon and authenticated roles no privilege on any table"*, two
assertions written specifically to make an opening argue for itself in a diff. The anon
assertions would still pass; the schema would stop being the thing they were protecting.

It also brings a session and refresh stack into the Worker, accounts that must be created
out-of-band because `enable_signup` is off — and changing that is a
[stop-and-ask](../principles.md#stop-and-ask) — and a `[auth]` block that
`supabase config push` sends to production on every merge touching a migration. For two
volunteers reading a list, that is a great deal of machinery, and **nothing else in this platform
signs in**.

### Cloudflare Access in front of the routes

The best answer to *identity* on this list: real per-person accounts, real login logs, real
revocation, no password handling in our code, and an identity provider somebody else operates.

**It loses testability, which is the one thing this slice could not give up.** There is no Access
in Miniflare and none on a laptop, so every test would have to run down a bypass path — and a
bypass path is exactly the hole the brief said must not exist: *a test must fail if the check is
removed*. It also cannot be configured from this repository, so it would ship inert until
somebody opened a dashboard, and trusting the identity it asserts means verifying a JWT against
Cloudflare's JWKS in the Worker or the header is spoofable by anyone reaching the Worker directly.

**It is recorded as the additive upgrade rather than refused.** Access in front and this
arrangement behind compose: Access answers *which human* and the Worker secret still answers *may
this Worker read entries*. The day somebody is at the Zero Trust dashboard anyway, the person-key
half can be retired and the audit trail keeps working, because the handle is what it records.

### One shared password, and no per-person key

The simplest possible version of what was chosen, and the brief's own option (b).

**It loses the three things the second credential buys**, exactly as predicted: one shared
credential, no audit trail worth the name, and no way to revoke one person without revoking
everyone. For two volunteers the last of those is one `wrangler secret put` and a message — which
is why it is defensible — but the first two are not recoverable later. An export log that cannot
say who took a copy of two hundred and fifty runners' emergency contacts is a log that answers
the wrong question, and it is the question somebody will actually ask.

The cost of not taking it is one table, one function and a sign-in form.

## Consequences

**The anon-executable function list goes from seven to thirteen**, and
`packages/db/tests/entries.test.ts` names the set so that growth arrived in a reviewed diff.
Five of the six require the admin key. The sixth, `delete_expired_medical_notes()`, deliberately
does not: it can only delete what `/nn/privacy/` has published a promise to delete, and gating it
would make a **legal retention obligation stop being kept on any day the key was not installed**.

**The admin pages are built in the Worker rather than painted onto static Astro**, and this is
the first place in the repository that is true. A list of entries is a variable number of rows;
painting needs a fixed slot per row, which is why `NnPreviousYears.astro` ships exactly four
anchors. The alternative inside the existing arrangement is
`setInnerContent(..., { html: true })`, and there is deliberately no such call anywhere here — so
adding the first one on the page that renders other people's names was not on offer.
`worker/html.ts` is the answer: an auto-escaping tagged template with no unsafe escape hatch at
any call site, and `raw()` as the single thing a reviewer has to check.

**Nothing on this surface changes a record.** No editing, no refunds, no transfers, no manual
entry, no resend. Each needs its own thinking about what it means to alter something somebody
paid for, and the list is built so the gap is visible rather than hidden: a status is a word, not
a control, and both buttons on the page read rather than write.

**A third Worker secret joins the manual steps.** `apps/main/README.md` records installing the
digest and issuing a person key; both are things a human does once, and both are written down
because that is what makes a manual exception legitimate rather than merely convenient.

---

## Amended, 25 August 2026 — a second door, and the actor becomes a uuid

**The decision above is unchanged and the mechanism still works.** This note records what
[#57](https://github.com/southville-running-club/src-website/issues/57) added beside it, because
one paragraph of it bears directly on the reasoning above.

`20260825120000_entries_reads_behind_nn_admin.sql` gives four of the five key-gated functions a
role-checked counterpart, granted to `authenticated` and gated on
`identity.has_role('nn-admin')`. It is the **expand** half of expand–migrate–contract; the key
path is untouched, and retiring it is #63's, after race day.

Two things this ADR argued are worth revisiting in the light of it.

**"Supabase Auth accounts, with RLS keyed on role" loses the grant-free schema** — that objection
was right, and it is the reason the role path is still definer functions rather than policies on
the entry tables. `entries` has no grant and no policy on any table, exactly as before;
`packages/db/tests/entries.test.ts` asserts both, and now also asserts the exact set of functions
`authenticated` may execute. What changed since 16 August is not the objection but its premise:
`enable_signup` was off and *"nothing else in this platform signs in"*. ADR-015 settled that, and
[#51](https://github.com/southville-running-club/src-website/issues/51) built it.

**The audit actor is a uuid on the role path**, and the rule this ADR set survives it intact:

> The handle is a role, not a person's name … a name there would be personal data in a table
> whose whole purpose is to be kept and read later.

`auth.uid()::text` is 36 characters, inside `admin_audit.actor`'s existing 40-character
constraint, so no column migrates. It is pseudonymous, and — unlike a handle — the mapping to a
human lives in `identity.people`, behind row-level security, rather than in a table in
[the runbook](../../delivery/runbooks/entries-admin.md) maintained by hand. It is also not
asserted by the Worker from a cookie it signed itself: the database reads it from a token GoTrue
issued, so there is no argument for a caller to choose.

**Rows written under the key scheme keep their handles.** Mixed values in one column is what a
migration between identity schemes looks like, and the runbook's "who has read medical data"
query must return both kinds — `packages/db/tests/entries-admin.test.ts` asserts that it does.
