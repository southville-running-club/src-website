# Runbook — how a marshal or a timing admin gets in

`/timing` is the club's race-timing surface. It answers **404 to everybody without a
`timing.*` permission**, the signed-out public included, and it is linked from nowhere. This
is how a named human gets from "no account at all" to "can open the thing I was asked to
open" — and how to work out which step was missed when they cannot.

**Prerequisites:** the person's own email address and a device with JavaScript enabled, for
them; an account holding `identity.role.grant` for whoever grants the role; an account
holding `timing.marshal.assign` for whoever puts them on a race's roster. **No database
credentials, no Cloudflare dashboard, no `wrangler`.**

**About five minutes each, spread over two people** — plus however long the person takes to
confirm their email address.

---

## Read this first: nobody carries over, and nobody creates an account for anybody

Two facts decide the whole shape of this procedure.

**`auth.users` does not cross Supabase projects.** Everybody who ran Pass the Buck 2026 on
the old platform re-onboards here from nothing.
[ADR-036](../../architecture/decisions/adr-036-timing-staff-are-identity-permissions.md)
names that as a race-simulation item rather than a footnote: the roster is cold, and it is
cold for the admins as much as for the marshals.

**Sign up first, then be granted.** The old application had admin-created passwords. This
platform has no such mechanism and will not grow one: `/admin/people/` grants roles to
accounts that already exist, and it cannot make one. So the first step always belongs to the
person themselves, and it cannot be done for them the night before.

---

## Step 1 — the person signs up, and confirms their address

Theirs to do, at **`/account/sign-up/`** on the club's site.

- [ ] They register at `/account/sign-up/` with an address they can read
- [ ] They open the confirmation email and follow the link
- [ ] They sign in at `/account/sign-in/` and land on `/account/`, holding `registered` and
      nothing else

⚠️ **Signing up needs JavaScript, and this is the one part of the site where that is true.**
The form carries a Cloudflare Turnstile widget, which has no no-script mode — #48's ADR
accepted that cost deliberately for the account area. With scripting off the widget never
renders and the form says so plainly, with the club's address on it. It is an honest dead
end rather than a button that does nothing, but it is still a dead end: **a marshal
onboarding from a phone with scripting disabled cannot complete this step.** Tell them to
turn it on.

**`registered` opens nothing.** At the end of step 1 they can see their own account and
their own race entries, and `/timing` still answers 404 to them. That is expected, and it is
the most common thing reported as a broken link.

**A confirmation that never arrives** is [the email runbook](entries-email.md)'s problem
rather than this one's — account mail is not in the entries outbox, so it will not be on
`/admin/emails/`. Check the spam folder first.

---

## Step 2 — somebody grants them the role

Done by somebody holding **`identity.role.grant`**, at **`/admin/people/`**. The full
procedure, the bootstrap and what the page refuses are in
[the admin runbook](entries-admin.md#granting-somebody-a-role); it is the same page and the
same button.

- [ ] Sign in and open `/admin/people/`
- [ ] Find them by email address. **They must have done step 1** — this page grants roles,
      it does not create accounts
- [ ] Press **Grant timing-marshal**, or **Grant timing-admin**
- [ ] Tell them to open `/timing`. **It takes effect on their next request**

Every grant is written to `identity.audit` in the same transaction as the change, so one
cannot happen without the other.

### The two roles, and which of the six permissions each carries

Quoted from
[`identity-permissions.test.ts`](../../../platform/packages/db/tests/identity-permissions.test.ts),
which asserts the sets exactly — a change to any of them fails that file before it reaches
production. **Read it rather than this table if the two ever disagree.**

| Permission | `timing-marshal` | `timing-admin` | `src-admin` |
| --- | --- | --- | --- |
| `timing.crossing.record` | ✅ | ✅ | ✅ |
| `timing.crossing.resolve` | — | ✅ | ✅ |
| `timing.event.manage` | — | ✅ | ✅ |
| `timing.marshal.assign` | — | ✅ | ✅ |
| `timing.registration.import` | — | ✅ | ✅ |
| `timing.result.publish` | — | ✅ | ✅ |

**No other role carries any of them.** `nn-admin`, `people-admin`, `super-admin`,
`nn-tester`, `nn-results` and `registered` hold none — a super-admin can *grant*
`timing-admin` and still cannot open `/timing` until they grant it to themselves, which
writes its own audit row. That is ADR-017's rule holding: **a grant is not an inheritance.**

⚠️ **`timing-marshal` holds exactly one permission and that is the point.** That phone is
used in a crowd, often by somebody who volunteered that morning. It cannot list races,
cannot resolve an anomaly, cannot import an entry list full of names, addresses and ages,
and cannot publish a result.

⚠️ **Neither role is staff.** Neither is on `STAFF_ROLES`, so **neither opens `/admin/`** —
a timing admin who needs the entry list needs `nn-admin` as well, granted separately.
`nn.results.read`, which opens `/nn/<year>/results/` on the club's site, is carried by
`nn-results` and `src-admin` and **deliberately not by `timing-admin`**: running a race and
reading its results before they are public are different powers.

⚠️ **`nn.results.read` is never widened to publish a result**, and
[ADR-042](../../architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md)
records why the shape `20260911180000`'s header imagined was rejected: a permission is a fact
about a person and publication is a fact about a race, so widening it would publish every race
at once and could be undone for none of them. Publication is `timing.result.publish` — above in
this table, carried by `timing-admin` and `src-admin` — calling `timing.publish_results()` on
one race, after it is finished and with nothing on its triage list. **Somebody holding
`nn.results.read` and nothing else can read a result early and cannot publish it**, which is the
whole reason the two exist apart.

---

## Step 3 — somebody puts them on the race's roster

Done by somebody holding **`timing.marshal.assign`**, at
**`/timing/events/<slug>/marshals/`**.

- [ ] Open `/timing/events/` and follow the race
- [ ] Open **Marshals**
- [ ] Choose them under **Add somebody** and press **Add to this roster**

**The picker only lists people who already hold `timing.crossing.record`**, and
`assign_marshal()` refuses anybody else outright rather than writing a row that means
nothing. So if the person is not in the list, **step 2 has not been done** — go back and do
it, then reload this page.

**The picker shows an email address where the roster shows "No name recorded".** Nothing
writes `identity.people.name` yet. The roster is who is at the line; the picker's job is
identifying one specific person before putting them on a race, and a list of
indistinguishable rows is how the wrong person gets assigned.

### ⚠️ The roster narrows a permission and cannot grant one

**Adding somebody here does not make them a marshal.** It says which races a person who is
*already* a marshal may record a crossing on. Granting the role is step 2 and happens
somewhere else entirely.

**A `timing-admin` is not on every roster by holding the role.** The old application let a
global admin bypass the roster; ADR-036 checks it **after** the permission, for everybody.
So **an admin who is going to stand at the line adds themselves like anybody else** — and
the page says so in as many words when a roster is empty, because otherwise the first time
anybody finds out is on a start line.

---

## ⚠️ A granted marshal who is not on the roster gets a 404, and that is not a bug

**This is the paragraph to read at 9am on race morning.** It has two halves and they are
both true at once.

**The rule.** `/timing/marshal/<slug>/` demands `timing.crossing.record` **and** a
`timing.marshals` row for that event. A marshal who holds the role but is not on *this*
race's roster is refused, and the refusal is the site's ordinary 404 — byte for byte what a
genuinely missing address returns, because a 403 would disclose that the address exists. The
fix is step 3, and it takes about fifteen seconds.

⚠️ **This said "there is no page under `/timing/marshal/` at all" until 13 September 2026,
and the capture screen is built now** —
[#203](https://github.com/southville-running-club/src-website/issues/203). Until that day
`middleware.ts` refused the address **outright**, for everybody, including a marshal who *was*
on the roster, because nothing answered the question *"am I, a marshal holding only
`timing.crossing.record`, on this event's roster?"* — the four functions
[#245](https://github.com/southville-running-club/src-website/issues/245) built are all behind
`timing.marshal.assign`, which is an admin's permission. `timing.marshal_event()` is that
answer now, and step 3 is what decides it.

**So step 3 is the one that has a visible effect on race morning.** A marshal who is granted
the role and left off the roster gets the same 404 as somebody who was never granted anything,
and the only way to tell from the outside is to work down this runbook.

⚠️ **A marshal already on the screen who is taken off the roster is not told which it was.**
The refusal is the same 404 whether a session lapsed or a roster row was deleted — deliberately,
because the door must not be an oracle — so the screen says *"either you have been signed out,
or you have been taken off this race's marshal list"*. **Nothing they have recorded is lost**:
the queue lives in IndexedDB on the phone, keyed to the origin rather than to the session, and
it drains once they are let back in. If somebody reports that sentence, check step 3 before
assuming it is a sign-in problem.

---

## What each role can and cannot open

Every ❌ below is **the same ordinary 404** — signed out, wrong role, right role wrong
roster, an address nobody built. So this table is how somebody who was refused works out
which step was missed, rather than guessing from the page.

The permission each address demands is
[`lib/access.ts`](../../../platform/apps/timing/lib/access.ts)'s table, and
[`middleware.ts`](../../../platform/apps/timing/middleware.ts) is the one place that
enforces it.

| Address | Demands | `registered` | `timing-marshal` | `timing-admin` |
| --- | --- | --- | --- | --- |
| `/timing` | any `timing.*` | ❌ | ✅ | ✅ |
| `/timing/health` | nothing — public | ✅ | ✅ | ✅ |
| `/timing/events/` | `timing.event.manage` | ❌ | ❌ | ✅ |
| `/timing/events/<slug>/` | `timing.event.manage` | ❌ | ❌ | ✅ |
| `/timing/events/<slug>/marshals/` | `timing.marshal.assign` | ❌ | ❌ | ✅ |
| `/timing/marshal/<slug>/` | `timing.crossing.record` **and a roster row** | ❌ | ✅ **on a race they are rostered for**, ❌ on any other | ❌ unless rostered — the permission is not enough, see above |
| `/admin/` and everything under it | a staff role | ❌ | ❌ | ❌ |
| `/nn/<year>/results/` | `nn.results.read`, **until that race's results are published** | ❌ | ❌ | ❌ |

**An address with no rule written for it is refused rather than opened.** Adding a page to
`/timing` means adding a row to `lib/access.ts`, and forgetting to is a page that does not
open — not one that opens to anybody.

### When somebody says "it 404s for me"

Work down this list. The first ✅ that turns into a ✗ is the answer.

1. **Are they signed in?** `/timing` never redirects to a sign-in page — that would disclose
   the address. Send them to `/account/` on the club's site: if that shows their account,
   they are signed in.
2. **Has their session lapsed?** Thirty minutes idle, twelve hours absolute —
   [ADR-019](../../architecture/decisions/adr-019-a-session-ends-on-its-own.md). ⚠️ **The
   timing app reads a session and never refreshes one**, so it cannot extend a lapsed one.
   Opening any page on the club's side puts it right.
3. **Do they hold the role?** `/admin/people/` shows every account and every role it holds.
   If the role is missing, the answer is step 2 above.
4. **Do they hold the *right* role?** A `timing-marshal` is refused `/timing/events/`. That
   is correct, and it is the most common false alarm — the table above says which.
5. **Is it the marshal address?** Then it is refused today whatever they hold. See the
   warning above.
6. **Did they mistype it?** A volunteer who mistypes an address gets exactly the blank an
   attacker gets. This is the cost of refusing with a 404 and it is worth paying.

---

## Who to ask

**By role rather than by name**, because the names change and the roles are what the
platform actually checks. `/admin/people/` is the list of who currently holds what — it
needs `identity.person.read`, which `people-admin`, `super-admin` and `src-admin` carry.

| I need | Ask somebody holding |
| --- | --- |
| An account | Nobody. **You create it yourself** at `/account/sign-up/` |
| `timing-marshal` or `timing-admin` granted | `identity.role.grant` — a **`super-admin`**, or a club director holding **`src-admin`** |
| Putting on a race's roster | `timing.marshal.assign` — a **`timing-admin`**, or **`src-admin`** |
| To know whether somebody has registered yet | `identity.person.read` — a **`people-admin`** is enough, and is what to hand out for this rather than `super-admin` |
| Results on `/nn/<year>/results/` | `identity.role.grant`, for the **`nn-results`** role. Not `timing-admin` |
| The entry list, exports or medical notes | `identity.role.grant`, for **`nn-admin`**. A timing role opens none of it |

⚠️ **No system is reachable by only one person.** At least two named people should hold
`timing-admin` on production before race day, for the same reason the club keeps a second
`nn-admin`: the break-glass is a second human, not a key in a password manager. **This has
not been done** — see the asks below.

---

## Two things owed to a human, and neither is in this repository

Recorded here because this runbook is where the ask lives. Both need somebody with access to
a dashboard that no code here can reach.

| | Asked | Of | State |
| --- | --- | --- | --- |
| **1 — the Squarespace `/timing` mapping** | 13 September 2026 | Whoever holds the Squarespace login | **Outstanding** |
| **2 — who holds the Supabase and Cloudflare logins** | 13 September 2026 | The committee | **Outstanding** |

### 1 — `southvillerunningclub.co.uk/timing` sends the public to a 404

The old site carries a URL mapping, added 13 August 2026, forwarding
`southvillerunningclub.co.uk/timing` to the timing Worker. That was right when `/timing` was
a public holding page. **Since 11 September 2026 `/timing` is staff-only**, so anybody
following that link from the old site lands on a page that says "Not found".

**Either remove the `/timing` mapping, or point it at `/nn/`**, where race information for
the public actually lives. Pointing it at `/nn/` is the better of the two: the address is
published and a link that goes somewhere useful beats one that goes nowhere.

It is a Squarespace dashboard setting with no API, so it is a hand step.
[The signposting runbook](squarespace-signposting.md#record-of-execution) owns the mapping
and is where the change gets recorded once it is made. **Nothing in this repository changes
either way.**

### 2 — who holds the club's Supabase and Cloudflare logins

Not recorded anywhere. It matters for this runbook specifically because **the recovery path
for "nobody can get into `/admin/people/`" needs the Supabase dashboard**, and if nobody can
name who holds that login the recovery does not exist —
[the admin runbook](entries-admin.md#if-nobody-can-get-in) describes the procedure and
assumes somebody can sign in.

Everything a volunteer needs day to day is behind a club account and a role, deliberately —
[the Supabase](supabase-setup.md) and [Cloudflare](cloudflare-setup.md) runbooks are the
only procedures here that want either login, and both are one-off setup rather than
operations. **Write the answer down where the committee keeps such things, not in this
public repository.**

---

## What this runbook deliberately does not carry

**The old application's screenshots.** `kayleigh-race-night.md` in `src-race-timing` is the
only other document describing how a marshal gets in, and it describes **a different
application on a different origin with admin-created passwords**. Copying its pictures would
document a sign-in page that does not exist here and a mechanism this platform refuses to
build. [The review of that application](../../reference/timing-app-review.md) is where its
model is recorded, for comparison rather than for use.

**Anything about capturing a crossing.** Nothing here records a time yet. What exists and
what does not is in [Phase 4](../phases.md#phase-4--the-timing-app-on-cloudflare).
