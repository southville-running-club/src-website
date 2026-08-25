# Cloudflare rate-limiting rules — the committed copy

**Every rate-limiting rule the club has, in one table, whether or not it has been created
yet.** A dashboard rule is not code: it has no history, no review, no rollback and no way
for the second volunteer to see what the first did.
[ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md)'s answer
to that is the same one it gives DNS — **the reviewable artefact is what the requirement is
asking for; the apply mechanism is not.** This file is that artefact, and the zone file two
doors down is its sibling.

**Nothing here is live until a row says so.** The status column is the only place that
records it, and a rule created without updating this file is drift in exactly the way a
DNS record changed without updating the zone file is drift.

| Serves | |
| --- | --- |
| [**Opening entries**](../delivery/runbooks/entries-open.md#01--the-waf-rate-limiting-rule-must-be-live) | Rule **E1**, and it is that runbook's step 0.1 — the one failure in the entry design with no recovery path |
| [**Opening accounts**](../delivery/runbooks/accounts-open.md) | Rules **A1**–**A4**, and they are that runbook's step 0.1 |

---

## The rules

**Counted per client IP address** (`ip.src`), which is the real runner's address: Cloudflare
sees the request before the Worker does. **That is the whole reason this layer exists** —
inside the Worker every Supabase call is made server-side, so GoTrue's own per-IP limits in
[`config.toml`](../../platform/packages/db/supabase/config.toml)'s `[auth.rate_limit]` count
against a Cloudflare egress address shared by the entire club, and cannot tell two people
apart. The two layers answer different questions and neither substitutes for the other.

| | Endpoint | Expression | Threshold | Period | Action | Mitigation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **E1** | The race forms | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/nn/") and not http.request.uri.path eq "/nn/stripe-webhook" and not starts_with(http.request.uri.path, "/nn/admin")` | 20 | 60s | Block | 60s | **Not created** — [#19](https://github.com/southville-running-club/src-website/issues/19) |
| **A1** | Sign in | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and http.request.uri.path eq "/account/sign-in/"` | 5 | 60s | Block | 600s | **Not created** — [#64](https://github.com/southville-running-club/src-website/issues/64) |
| **A2** | Sign up | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and http.request.uri.path eq "/account/sign-up/"` | 3 | 60s | Block | 3600s | **Not created** — #64 |
| **A3** | Password reset | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and http.request.uri.path eq "/account/reset/"` | 5 | 600s | Block | 3600s | **Not created** — #64 |
| **A4** | The admin surfaces | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and (starts_with(http.request.uri.path, "/admin/") or starts_with(http.request.uri.path, "/nn/admin"))` | 10 | 60s | Block | 600s | **Not created** — #64 |

**`http.host` is in every expression on purpose, and it is the one line here with an expiry
date.** The zone also serves the Squarespace site at the apex, and none of these paths exists
there — scoping the rules to the platform hostname stops a rule counting requests it has no
business counting. `new.` is the club's one public hostname today and
[ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md) has it
dropping at the Squarespace cutover: **every row above changes on that day**, and this file is
where somebody will look for what has to change.

---

## Why each number is what it is

### E1 — the race forms, 20 a minute

**The exposure is [#19](https://github.com/southville-running-club/src-website/issues/19)'s**,
and it is the only one in the entry design with no recovery path:
`entries.create_pending_purchase()` is granted to `anon`, the anon key is published in page
source, and every successful call holds a place for 31 minutes. A held place is
indistinguishable from a real runner's, so there is no query that cleans it up.

**The path is a prefix, not `/nn/` exactly, and that is a correction rather than a
flourish.** #19 was written when the entry form was on `/nn/`.
[ADR-011](../architecture/decisions/adr-011-a-race-and-its-runnings.md) has since split the
pages: `POST /nn/` is now the *interest* form and `POST /nn/2026/` is the entry form — **the
one that holds places.** A rule written to the letter of the issue would cover the harmless
half and miss the expensive one.

**Twenty a minute**, because a real entrant submits once and, with validation errors on a
fourteen-field form, perhaps three or four times. Twenty from one address inside a minute is
not somebody filling in a form. The number that is most likely to need raising is this one:
a mobile carrier puts hundreds of subscribers behind one address, and the morning entries
open is exactly when a group of them submits at once. **If legitimate blocks are reported,
raise this before touching anything else**, and record the new number here.

**Block, not a challenge.** A managed challenge on a `POST` interrupts the submission, and
the entry form does not survive that: fourteen fields typed on a phone on bad signal are
gone. The mitigation is 60 seconds for the same reason.

**`/nn/stripe-webhook` is excluded.** Stripe's delivery volume is not a person's, and a block
there stops payments being *recorded* rather than stopping anything being taken. Nothing is
lost — Stripe retries for three days — but the dashboard fills with red and the
[attention runbook](../delivery/runbooks/entries-attention.md) gets exercised for no reason.
`/nn/admin` is excluded because **A4** covers it with a tighter number.

### A1 — sign in, 5 a minute, blocked for ten

**Credential stuffing against addresses from a breach list.** Turnstile raises the cost of a
request; it does not cap them, and it does nothing at all about a real person trying two
hundred passwords.

A person mistypes a password twice, looks at the keyboard, and gets it right. **Five in a
minute is already past what a person does**, and the ten-minute mitigation is what turns the
rule from a speed bump into a cost: it cuts a single address from thousands of attempts an
hour to thirty. It does not answer a distributed attempt, and nothing counted per IP does —
what answers that is [`[auth.rate_limit]`](../../platform/packages/db/supabase/config.toml)'s
project-wide ceiling behind it, and a password minimum of twelve characters in front.

### A2 — sign up, 3 a minute, blocked for an hour

**Bulk account creation costs free-tier rows and the club's mail reputation**, and each
account created is a confirmation email sent from the club's sender to an address the caller
chose. A person creates one account, once, ever. Three inside a minute still covers two people
signing up from the same house one after the other; the hour only begins after the fourth.

An hour's mitigation costs a legitimate person nothing, because by the time it applies they
already have the account they came for.

### A3 — password reset, 5 in ten minutes, blocked for an hour

**This is the mailbomb door, and it is the only endpoint on the platform where the cost lands
on somebody who never visited the site.** The caller names the address; the club's sender
delivers to it. What is spent is somebody else's inbox and the club's sending reputation with
it, and neither is recoverable by anything in this repository.

So the window is ten minutes rather than one: a real person asks for a link, waits for the
mail, does not find it, and asks again. Five in ten minutes covers that twice over.

**GoTrue's own `max_frequency = "1s"` is not a defence here** — it is a minimum gap between
sends and a second is nothing. See [what is still open](#what-is-still-open).

### A4 — the admin surfaces, 10 a minute, blocked for ten

**Two prefixes, because there are two admin surfaces and they overlap in time.**
`/nn/admin` is today's, gated by the two keys in
[ADR-013](../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md);
`/admin/` is the role-gated shell [#58](https://github.com/southville-running-club/src-website/issues/58)
builds, and [#63](https://github.com/southville-running-club/src-website/issues/63) retires
the first one afterwards. A rule covering only one of them has a gap for as long as both
exist.

**#58 replaced the keys with a role**, so there is no longer a credential to guess at this
address at all — `/admin/*` answers 404 to everybody who is not already signed in, and signing
in happens at `POST /account/sign-in/`, which rule A1 covers. What remains here is the cheaper
half of the same concern, and it is the half that was always the real one:
[the admin runbook](../delivery/runbooks/entries-admin.md) is a published list of addresses, a
request to any of them is a database round trip, and free-tier compute is spendable by anybody
who can read it.

---

## If the plan allows only one rule

**The club is on Cloudflare's free plan**, and the free plan's rate-limiting allowance is
smaller than five rules — how much smaller is the first thing to check in the dashboard,
because it changes, and **finding that a free tier's terms differ from what is recorded here
is its own [stop-and-ask](../architecture/principles.md#stop-and-ask)**. The period and
mitigation options are shorter there too; take the longest the plan offers and **write down
which**, rather than leaving this table describing a rule that does not exist.

If exactly one rule is available, this is it:

```
http.host eq "new.southvillerunningclub.co.uk"
and http.request.method eq "POST"
and (
  starts_with(http.request.uri.path, "/account/")
  or starts_with(http.request.uri.path, "/admin/")
  or starts_with(http.request.uri.path, "/nn/")
)
and not http.request.uri.path eq "/nn/stripe-webhook"
```

**Threshold 20 per 60 seconds, Block, longest mitigation available.**

**Read what that costs before creating it.** One rule takes one threshold, and it has to be
the loosest of the five — 20, E1's — because a combined rule set to A2's three would block
the entry form on the morning it matters most. So the account endpoints end up protected at
roughly four times the number this page argues for them, and **A3's mailbomb window collapses
from ten minutes to one**, which is the one that hurts. It is better than nothing and it is
not what is written above.

**Record which of the two shapes was actually created**, in the status column. If the answer
is the combined rule, the honest next question is whether the account endpoints are worth a
paid plan — the first thing on this platform that would be.

---

## What is still open

- **`[auth.email] max_frequency = "1s"`** is the minimum gap between two sends to the same
  address, and one second is not a limit. Raising it is a small change with a real effect on
  **A3**'s exposure, and it belongs to whoever next opens that block — noted here rather than
  changed alongside the rules, because it is a different layer and this repository ships one
  change at a time.
- **A blocked person sees Cloudflare's own page, not the club's.** Nobody has looked at what
  that page says, and the
  [accounts-open runbook](../delivery/runbooks/accounts-open.md#03--somebody-has-actually-tried-it)
  makes recording it a step rather than an assumption. Whether it can be customised on this
  plan is part of the same question.
- **Nothing here covers a `GET`.** Every rule is scoped to `POST` because that is where a
  credential is checked and an email is sent. A scraper reading pages is a different problem
  with a different answer, and inventing a rule for it here would be a rule nobody has
  reasoned about.

---

## What actually happened

**Nothing yet.** When a rule is created, add a row: the date, who created it, which rules,
what the plan actually allowed, and what a block looked like when it was tested. Then change
that rule's status above, so this table and the dashboard say the same thing.
