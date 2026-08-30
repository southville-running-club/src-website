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
| [**Opening entries**](../delivery/runbooks/entries-open.md#01--the-rate-limiting-rule-must-be-live) | That runbook's step 0.1 — the one failure in the entry design with no recovery path. It asked for **E1** until 30 August 2026 and asks for **C1** now, because E1 was never created and C1 covers the same `POST /nn/` prefix |
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
| **E1** | The race forms | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/nn/") and not http.request.uri.path eq "/nn/stripe-webhook" and not starts_with(http.request.uri.path, "/nn/admin")` | 20 | 60s | Block | 60s | **Superseded by C1** — never created as its own rule; the free plan allows one. [#19](https://github.com/southville-running-club/src-website/issues/19) |
| **A1** | Sign in | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and http.request.uri.path eq "/account/sign-in/"` | 5 | 60s | Block | 600s | **Superseded by C1** — never created as its own rule. [#64](https://github.com/southville-running-club/src-website/issues/64) |
| **A2** | Sign up | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and http.request.uri.path eq "/account/sign-up/"` | 3 | 60s | Block | 3600s | **Superseded by C1** — never created as its own rule. #64 |
| **A3** | Password reset | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and http.request.uri.path eq "/account/reset/"` | 5 | 600s | Block | 3600s | **Superseded by C1** — never created as its own rule. #64 |
| **A4** | The admin surfaces | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and (starts_with(http.request.uri.path, "/admin/") or starts_with(http.request.uri.path, "/nn/admin"))` | 10 | 60s | Block | 600s | **Superseded by C1** — never created as its own rule. #64 |
| **C1** | **The only rule that exists.** Every `POST` under `/account/`, `/admin/` and `/nn/` | `http.host eq "new.southvillerunningclub.co.uk" and http.request.method eq "POST" and (starts_with(http.request.uri.path, "/account/") or starts_with(http.request.uri.path, "/admin/") or starts_with(http.request.uri.path, "/nn/")) and not http.request.uri.path eq "/nn/stripe-webhook"` | **3** | **10s** | Block | **10s** | **The live rule**, created 25 August 2026 |

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
the entry form does not survive that: fifteen fields typed on a phone on bad signal are
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

## What the free plan actually allows — measured, 25 August 2026

**This section used to be a contingency. It is now the description of what exists.** The
numbers below were read off the dashboard rather than from Cloudflare's pricing page, which
is the only reason they can be trusted.

| | What the dashboard offered |
| --- | --- |
| **Rate limiting rules** | **1** — the panel reads `0/1 rules` |
| **Custom rules** | 5 — `0/5 rules`. **They cannot substitute**: a custom rule matches and blocks, it does not *count*, so it has no notion of a rate |
| **Managed rules** | None. The panel offers only *Upgrade to Pro* |
| **Counting characteristics** | **IP only.** The selector is fixed and greyed out; no second characteristic can be added |
| **Period** | **10 seconds.** The 60s and 600s this file specifies were not available |
| **Mitigation duration** | **10 seconds.** The 600s and 3600s this file specifies were not available |

**So the shape below is not a compromise the club chose. It is the only rule the plan can
express**, and the two dropdowns are the binding constraint rather than the rule count.

The expression that was created:

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

**Three requests per 10 seconds, Block, 10-second mitigation.** Every one of those three
values is the most the free plan offers, not a number anybody argued for.

### What this rule is, and what it is not

**It is a burst brake. It is not a cost.** The reasoning higher up this page for A1 turns on
the *mitigation*, not the threshold — ten minutes is what cuts an address from thousands of
password attempts an hour to thirty. **At 10 seconds it cuts it to roughly a thousand an
hour**, which an attacker does not notice. The same collapse applies to A2's hour and A3's
hour.

**And A3's window is the one that hurts, exactly as this page predicted.** Its ten-minute
counting window was chosen because a real person asks for a reset link, waits for the mail,
does not find it, and asks again. A 10-second window cannot express that at all: five
requests spread over ten minutes never trip it, so **the mailbomb door is effectively
unguarded by this layer**. What stands in front of it is Turnstile, which raises the cost of
a request without capping it, and GoTrue's own `max_frequency` — one second, which is not a
limit.

**Where it does work is the one place with no other recovery path.** E1's concern is a script
draining a 250-runner field by holding places, and that is a *throughput* attack: 3 per 10
seconds caps one address at 18 a minute whatever the mitigation is. A held place is
indistinguishable from a real runner's and there is no query that cleans it up, so a brake
that never fully stops still changes the arithmetic. **The rule earns its place on entries
and barely moves the needle on credentials.**

**Tighter than the five-rule shape in burst, weaker in every other respect.** Three in ten
seconds is stricter than 20 in sixty, so **the first thing likely to be reported is a
legitimate block** — a mobile carrier puts hundreds of subscribers behind one address, and
the morning entries open is when a group of them submits at once. The 10-second mitigation is
the saving grace: somebody blocked is through again before they have finished reading the
page.

### What this makes the honest next question

**Whether the account endpoints are worth a paid plan.** This is the first thing on the
platform that would be, and it is no longer hypothetical: the free plan cannot express the
control [opening accounts](../delivery/runbooks/accounts-open.md) says must exist before the
club announces accounts. That runbook's stop condition — *the rate-limiting rules are not
live* — is now satisfiable only in the letter. **Somebody has to decide whether the letter is
enough**, and it is a committee question about money rather than a build one.

**Until it is decided, this is what is live and this table says so.** That is the point of
the file.

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

### 25 August 2026 — one rule, because one rule is all there is

**Created by Mark**, in the zone's **Security → Security rules → Rate limiting rules** panel.
The Cloudflare dashboard has moved since this file was written: there is no *WAF* item in the
sidebar any more, and *Rules* — which is right there and looks correct — is Transform,
Redirect and Page Rules, a different feature entirely.

| | |
| --- | --- |
| **What was created** | **C1** only, the combined expression. Not E1, not A1–A4 |
| **Name in the dashboard** | `Combined — account, admin and race forms` |
| **Values** | 3 requests / 10 seconds / Block / 10-second mitigation, counted by IP |
| **Execution order** | First |
| **Status** | Active |
| **Why not this file's numbers** | **They were not on offer.** 20 was typed into a free-text box; 60s and the longer mitigations simply are not in the free plan's dropdowns. See [what the free plan actually allows](#what-the-free-plan-actually-allows--measured-25-august-2026) |

**The expression pasted clean at 283 of 4000 characters**, via *Edit expression* rather than
the visual builder — which is what this page asks for, because a hand-built rule with one
clause dropped looks identical to a correct one.

**Two things this run corrected in this file**, rather than the file correcting the run:

1. **The period and mitigation columns for A1–A4 and E1 describe values the club cannot buy.**
   They are kept because they are the argument, and because they become reachable the day
   somebody pays — but every one of those rows now says *superseded by C1*.
2. **The rule-count was never the binding constraint.** This page assumed the fallback cost
   was "one threshold instead of five". The real cost is the **10-second ceiling on both
   dropdowns**, which is what guts A1's and A3's reasoning. A page written from the pricing
   documentation would have got that wrong; reading the dashboard is what caught it.

### Still outstanding from this sitting

- [ ] **Nobody has watched it fire.** That is
      [accounts-open step 0.3](../delivery/runbooks/accounts-open.md#03--somebody-has-actually-tried-it),
      and it is a stop condition for announcing accounts — a rule that has never fired is a
      belief, not a control
- [ ] **What a blocked person sees** is unrecorded. It will be Cloudflare's own page rather
      than the club's; that is an acceptable answer and only acceptable once somebody has
      looked
- [ ] **Whether that page can be customised on this plan** has no answer
- [ ] **Whether the account endpoints justify a paid plan** — now a real question rather than
      a rhetorical one, and it belongs to the committee
