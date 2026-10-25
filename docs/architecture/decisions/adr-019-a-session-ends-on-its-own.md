# ADR-019 — A session ends on its own: thirty minutes idle, twelve hours absolute

**Accepted**, 28 August 2026.

| | |
| --- | --- |
| **Requirement** | [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **Relates to** | [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-015](adr-015-member-accounts-on-supabase-auth.md) |
| **Supersedes** | No ADR. ADR-015 built the session; it never said how long one lasts, and the answer it inherited was Supabase's default |

## Context

**A session lasted thirty days, and nobody decided that.** `worker/session.ts` wrote the
refresh cookie with `REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30`, described in its own
comment as *"Supabase's own default refresh-token lifetime"* — a sensible thing to copy while
the account area had no pages behind it, and never revisited once it had. Signing in on a
Tuesday left somebody signed in a fortnight later, on any device the cookie was still on.

That is not a hypothetical. It is what somebody noticed by opening the site on a different day
and finding themselves already inside their account, which is the point at which "we never
chose this" stops being a comfortable answer.

**What is behind the session now is not what was behind it in August.** `/account/entries/`
lists what somebody has entered and what they paid. `/admin/nn/` lists **every** entrant's
emergency contact, reads medical notes one at a time, exports the lot as CSV, and — since
[ADR-018](adr-018-cancelling-an-entry.md) — refunds a purchase. One cookie jar opens all of it,
because staff sign in through `/account/sign-in/` like everybody else. A session that survives
a fortnight of a laptop being closed, lent, resold, or left on a train is the wrong shape for
that, and it is the wrong shape for [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully)
regardless of what it is worth to an attacker.

## Decision

**Two timeouts, and both of the ones the standards name.**

| | | Where the number comes from |
| --- | --- | --- |
| **Idle** | **30 minutes**, sliding | NIST SP 800-63B, AAL2: reauthenticate "following any period of inactivity lasting 30 minutes or longer". The loose end of OWASP's *15–30 minutes for low risk applications* |
| **Absolute** | **12 hours**, from authentication | NIST SP 800-63B, AAL2: reauthenticate "at least once per 12 hours during an extended usage session" |

**AAL2's numbers rather than AAL1's**, and that is the only judgement call on this page worth
arguing with. AAL1 asks for reauthentication once per **thirty days**, which is almost exactly
what the platform was already doing by accident. The reason to hold the account area to AAL2's
timings while it is authenticated by a single factor is that the same session opens the admin
surface: whoever is behind that cookie can read two hundred people's emergency contacts and one
medical note at a time. The timings are cheap and they are what the tier is measured in; the
second factor is a separate decision nobody has taken yet.

**One set of numbers for members and for staff.** A tighter idle window for staff alone is
tempting and it is not buildable honestly: it is the same cookie, and the role it opens is read
per request from `identity.my_permissions()` rather than baked into the session. Splitting them
would mean a session that means different things at two addresses, which is a worse thing to
own than thirty minutes of impatience.

**In practice the idle window is the one anybody meets.** Twelve hours only bites somebody
using the site continuously through a working day; half an hour of a tab left open ends it long
before that on any ordinary afternoon. Which is the intended shape: the absolute deadline is
there to bound the session, not to be the thing a runner notices.

### How each is enforced, which is not the same, and the honest version of it

| | Enforced by | What that does not stop |
| --- | --- | --- |
| **Idle** | Cookie `Max-Age`, re-issued on every request that carries a live session | A client that keeps presenting a cookie it was told to forget |
| **Absolute** | Checked in the Worker on every request, against the `src_ax` cookie **and** the authentication time GoTrue signs into the access token's `amr` claim — whichever is stricter | Nothing, while GoTrue sends `amr` |

The idle window is a browser's promise, which is how session expiry works nearly everywhere and
is worth saying out loud rather than dressing up. The absolute deadline is not: `src_ax` alone
would be forgeable by exactly the adversary an absolute timeout exists for — somebody holding a
copied cookie jar, who can edit a deadline as easily as they can present a token — so it is
checked against a claim GoTrue signed, which they cannot. The cookie is what keeps the deadline
working if `amr` ever stops arriving; the claim is what makes it mean something while it does.

**And an expiry revokes rather than forgets.** Reaching either deadline calls Supabase's own
`/logout` with the session's tokens on the way out, exactly as `/account/sign-out/` does, so the
refresh token is dead rather than merely absent from one browser.

### The one sanctioned keep-alive — added 12 September 2026, for the marshal screen

**`GET /account/keep-alive/` slides the idle window without anybody looking at a page**, and it
is the only thing that may. It calls `readSession` and answers **204** with whatever cookies
that produced — three fresh ones for a live session, three cleared ones for a session past a
deadline, and **none at all for a caller who has none**. There is no branch in it that creates a
session, which is the property worth checking if it is ever touched: a route that minted would
turn an unauthenticated poll into a way of being issued one.

**Why it had to exist.** Cloudflare dispatches `/timing/*` to a different Worker at the edge,
and that Worker's middleware says of itself that it *"never refreshes, so it can never extend a
session"* — deliberately, so the only code that writes a session cookie stays in one file. A
marshal capturing crossings at Nightingale Nightmare is on `/timing` for about ninety minutes
and sends `apps/main` nothing in all that time, so the thirty-minute window above closes
underneath them **mid-race**, and every capture from then on fails. `/timing` and `/account/` are
the same origin, so one route here, called from there, fixes it without a second place that
mints sessions, a session exception for one permission, or a capture token of its own — the
three options [#244](https://github.com/southville-running-club/src-website/issues/244) set out.

⚠️ **It partially undoes the inactivity guarantee, and that is the honest cost rather than an
oversight.** A poll every five minutes *is* activity as far as a sliding window is concerned, so
a page left polling holds a session open until the **absolute** deadline — which nothing,
including this, can slide. Two things keep it to what was intended:

- **What counts as active is defined on the caller's side**: the marshal screen polls only while
  the page is **visible** and only when there has been a tap or a sync in the last twenty-five
  minutes. A tab left open on a table at a finish line is idle, and lapses exactly as this
  record intends.
- **Twelve hours still ends it.** A race morning fits inside that; a phone left in a pocket
  overnight does not.

⚠️ **A marshal offline for more than thirty minutes comes back signed out, and that is
accepted.** Cookies carry `Max-Age`, and a browser deletes an expired one offline as readily as
online — a keep-alive cannot run with no signal, and queueing one to send later would be
asserting activity that did not happen. Nothing is lost when it happens: the capture queue is
IndexedDB keyed to the origin rather than to the session, so the marshal signs in again and the
drain empties it. The race-night runbook says that in one sentence and the simulation does it
once on purpose.

### Two gaps in the keep-alive, closed 25 October 2026

**The keep-alive as first built still signed a working marshal out, in two ways, and closing
them changes nothing this record decided** — active is still a tap or a crossing that landed,
the windows are still thirty minutes and twelve hours, and the route still answers 204 whoever
asks.

- **The wait before the first runner.** A finish marshal who opened the screen at the 10:30
  briefing and touched nothing until the winner arrived was signed out at about 11:20, before
  the winner: the poll stopped at twenty-five idle minutes and the cookies ran out thirty after
  the last one. **The answer is a prompt rather than a longer window.** After twenty minutes
  with nothing tapped the screen shows a large *Keep me signed in* button, and pressing it is a
  tap — so a marshal who is there has about half an hour to notice it, and a phone nobody is
  near still lapses exactly as above. A keypad press counts as a tap too, which it always was.
- **An access token that expired between polls.** The token lives an hour, the timing Worker
  refuses an expired one, and this route only renewed it in its last sixty seconds — which a
  five-minute poll lands in about one time in five. The other four times, the door refused a
  live session for up to four minutes and the screen said the marshal had been signed out. The
  route now renews the token ten minutes early, for this address alone
  (`KEEP_ALIVE_REFRESH_WINDOW_SECONDS`), and the screen answers a refusal with one keep-alive
  and one retry before saying anything — only while it counts as active, so a retry can hold
  nothing open that the poll would have let go.

`apps/timing/lib/keep-alive.ts` carries the numbers and the reasoning.

**The status is 204 whoever asks.** Answering one status for a live session and another for none
would be an oracle for whether a copied cookie jar is still good, and the caller needs no such
signal — what tells the marshal screen a session has ended is its next sync failing.

**A person is told why.** Every `/account/` address that needs a session sends a timed-out
visitor to `/account/sign-in/?timed-out=ok`, which says they were signed out because the session
had been open a while and that nothing has been lost. It does not say *how long*, which would
be a copy edit every time these numbers moved and would tell anybody who asked how long a
borrowed laptop stays useful. The addresses that are *for* somebody signed out — sign-in itself,
sign-up, the magic link and OAuth callbacks, the reset pair — are deliberately not intercepted:
bouncing somebody off the page they were just sent to would be the only bug this feature could
plausibly ship with.

`/admin/` is unchanged and says nothing: an expired session there gets the same ordinary 404
every other unauthorised request gets, because a 403 discloses that the address exists.

⚠️ **`/admin/` now asks before it lets somebody go — 25 October 2026.** It still says nothing
*after* a session has ended, and the 404 is unchanged; what changed is that a signed-in page no
longer lets one end silently underneath somebody who is using it. Every page load here slides
the window and nothing between page loads did, so a volunteer reading a long list or filling in
a form for half an hour met the 404 on their next click. `worker/admin-stay-signed-in.ts` gives
every signed-in page the capture screen's rules: a keep-alive every five minutes while it is
being worked on (visible, and a tap or key in the last twenty-five), and after twenty quiet
minutes a *Keep me signed in* bar fixed to the foot of the screen. What counts as active, both
windows and the 404 a stranger gets are all as above — the bar rides on the club header, which
the 404 never carries.

## What the alternatives lose

### Supabase's own session limits

**This is the right answer and the club cannot have it.** GoTrue has both of these built in —
"Time-box user sessions" and "Inactivity timeout", at `dashboard/project/_/auth/sessions` — and
they end a session *inside the identity provider*, where it binds every client rather than every
browser, and where no cookie, claim or Worker code is load-bearing. It would delete most of what
this ADR adds.

They are **Pro-plan features**; the club is on the free tier. Setting them anyway would be worse
than not having them: `[auth]` in `config.toml` is a
[stop-and-ask](../principles.md#stop-and-ask) that ships to production on every merge touching a
migration, and it has **no partial apply** — [#79](https://github.com/southville-running-club/src-website/issues/79)
cost four red deploys establishing that a single rejected value takes `site_url`, the redirect
allowlist and `enable_signup` down with it.

**So this is the revisit trigger.** The day the club is on Pro for some other reason, these two
settings replace most of `worker/session.ts`'s new machinery, and the deadline cookie goes with
it.

### A shorter `jwt_expiry`, so the access token dies sooner

Same door, same refusal. `jwt_expiry` lives in the same `[auth]` block, and it would not help
anyway: the refresh token is what makes a session long-lived, and shortening the access token
only changes how often the Worker asks for a new one.

### A session table of our own

A row per session, with a last-seen timestamp, would make **both** timeouts server-side and
unforgeable rather than only the absolute one. It is also a write on every authenticated request,
a table, a policy, a cleanup job, and a grant on a fourteenth function — against a threat that
the signed `amr` claim already closes for the half that matters. It fails *boring beats optimal*,
and it is the wrong shape to build a month before the Pro-plan answer might make it redundant.

### Leave it, and rely on signing out

Sign-out already works and already revokes. It relies on somebody remembering, on a shared
laptop, three weeks ago — which is precisely the case a timeout exists for.

## Consequences

**Everybody signed in today is signed out once, on deploy.** A session from before this carries
no `src_ax` cookie, and a session with no readable deadline is refused rather than given one — a
missing deadline must not mean "no upper bound", the same way `entries_open_at is null` means
*never opens* rather than *no lower bound*. One sign-in, for two volunteers and an account list
that is currently short.

**Three cookies, not two, and `Set-Cookie` on every authenticated response.** A sliding window
has to be re-issued to slide. Nothing edge-caches a response carrying `Set-Cookie`, and the
account and admin pages are built per request anyway — and since 12 September 2026 the same is
true of a 204 carrying nothing else, which is what `/account/keep-alive/` is.

**An expiry costs a GoTrue call, and that is bounded rather than free.** Revoking on the way out
means one `/logout` per expired session presented — and where the access token has itself
expired, gotrue-js refreshes before it can log out, which counts against `token_refresh`, a limit
that is **project-wide** because every GoTrue call here is server-side (see the rate-limit section
of `apps/main/README.md`). It bounds itself in both directions: an ordinary browser presents an
expired jar once and is then holding cleared cookies, and a client replaying one deliberately
finds the refresh token already dead after the first attempt. Worth knowing about, not worth a
mechanism.

**`session.ts` reads a claim, which it had never done for a security decision before.** It is
confined to `authTimeOf`, only ever applied to a token `getUser()` or `refreshSession()` has
accepted in the same request, and it degrades to the cookie rather than to nothing.
`packages/db/tests/identity-sessions.test.ts` checks against the real local GoTrue that `amr`
arrives and that its timestamp survives a refresh — because a mocked GoTrue proves nothing about
the real one, and the failure this guards against is silent in the dangerous direction.

**The numbers are two constants and a test that names them.** Changing the club's mind about
thirty minutes is a one-line diff and a line in this file, not a rebuild.

## Exit cost

**An afternoon, and falling.** Two constants, one cookie, one claim read, and the redirect that
explains itself. If the club moves to Pro, most of it is deleted in favour of two dashboard
settings; if the numbers turn out to be too tight for how volunteers actually work, they are
constants.

## Revisit when

The club is on a Supabase Pro plan for any reason; a second factor is added to staff sign-in, at
which point AAL2's timings are being met by something other than the clock; or a volunteer
reports that thirty minutes is genuinely getting in the way of a job on `/admin/`, which is the
one number here chosen at the strict end of its own range.
