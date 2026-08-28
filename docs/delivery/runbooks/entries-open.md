# Runbook — opening entries

**This is the moment the club starts taking money from the public.** It is one `update`
statement against one row, it needs no deploy and no pull request, and that is exactly why it
has this file: there is no diff for anybody to review and no CI run to go red.

Everything that must be true before that statement runs is on this page, as
[step 0](#step-0--the-things-that-must-be-true-first). Nothing else in the repository collects
it — the four blocking issues live in a tracker nobody opens on the morning entries go live.

**Prerequisites:** the club's Supabase project (SQL editor), the Cloudflare dashboard, the
Stripe dashboard, and **the opening and closing times from the committee**. Both volunteers
available, and not at seven in the morning.

**About an hour**, most of it checking rather than typing, plus whatever step 0 still needs.

---

## Who does which part

**Every step below carries a tag, so nobody has to read the whole page to find their half.**
This runbook spans both volunteers by nature — it is the one procedure where the platform, the
race pages and the committee all have to be ready at the same moment — and the tags are what
stop that being a reason to skip it.

| Tag | Means | Today |
| --- | --- | --- |
| **⚙️ Ops** | The platform: Cloudflare, GitHub, Supabase, secrets, the database row | Mark |
| **🏁 Race pages** | `/nn/`, the entry form, and what a runner reads | Bindal |
| **🏛️ Committee** | Not a build decision at all. Somebody has to chase it | Both, to ask |
| **👥 Both** | Do it together, in the same room or the same call | — |

**Read your own tags before the day and the whole page on the day.** The ordering matters more
than the split: 0.1 gates everything, and step 3 must not happen until every box above it is
ticked, whoever ticked it.

---

## Stop conditions

Do not continue past step 0 if any of these is true. Each one is a way for this to go wrong
that cannot be undone by closing entries again afterwards.

| | Why it stops the run |
| --- | --- |
| ~~**The entry open and close times have not been supplied by the committee**~~ | **Met.** Agreed by the committee over WhatsApp on **Monday 24 August 2026**: **open Tuesday 1 September 2026 07:00 BST, close Friday 30 October 2026 17:00 GMT**. `entries_close_at` is already applied; this runbook sets the opening half only |
| **The rate-limiting rule is not live** | [Step 0.1](#01--the-waf-rate-limiting-rule-must-be-live). This is the only failure in the design with no recovery path |
| **No payment has ever completed end to end** | [Step 2](#step-2--rehearse-a-real-payment-without-opening-the-window). The first real payment must not be a stranger's |
| **The entry terms have not been written** | The form asks people to accept terms; today its hint says they are still to be confirmed. Taking £17 against terms that do not exist is not a build decision |
| **Nobody has restored a backup** | [#23 item 2](https://github.com/southville-running-club/src-website/issues/23). The rows about to arrive include dates of birth, emergency contacts and — under separate consent — medical notes |

---

## ⏰ The deadline this runbook now has: 07:00, Tuesday 1 September 2026

**`/nn/2026/` already tells runners that entries open at 07:00 on 1 September. Nothing in the
database enforces that.** The page reads `race.json`; the form reads
`entries.events.entries_open_at`, which is still null. **Until step 3 is run, the page promises
open entries against a form that is shut.**

**It fails silently and in the worst direction.** Nothing reads both values, so nothing can
notice they disagree — there is no alarm, no failing test, and no log line. What happens instead
is that people who set an alarm for 07:00 arrive to a page saying entries are open, find the
interest form, and email the club. The first the club hears of it is the inbox.

**So this is a diary entry, not a deploy.** One volunteer awake before 07:00 on Tuesday 1
September, with these two statements to hand. They are the same ones in
[step 3](#step-3--the-row-edit), repeated here so that whoever is awake is not scrolling for
them:

```sql
-- Opens Tuesday 1 September 2026, 07:00 BST. Explicit +01, so it does not depend
-- on the session's TimeZone. 07:00 BST = 06:00Z.
update entries.events
   set entries_open_at = timestamptz '2026-09-01 07:00:00+01'
 where slug = 'nn-2026'
returning slug, entries_open_at, entries_close_at, capacity, minimum_age;
```

```sql
-- Read back in the timezone a runner reads it in, never in UTC —
-- an hour out looks identical to correct there.
select entries_open_at  at time zone 'Europe/London' as opens_london,
       entries_close_at at time zone 'Europe/London' as closes_london
  from entries.events where slug = 'nn-2026';
```

**`opens_london` must read `2026-09-01 07:00` and `closes_london` `2026-10-30 17:00`.** `06:00`
or `18:00` means the offset went in the wrong way round — the clocks go back between the two
ends of this window, so they do not share one.

**If it is already past 07:00 when somebody notices**, run it anyway and then check
`/admin/nn/` for the interest sign-ups that arrived in the gap: those are people who tried to
enter and could not, and they are the ones to tell first.

**The permanent fix is to publish from the database rather than from `race.json`**, which
removes the gap instead of scheduling around it. That is an ADR after entries open, not a change
to make in the week before — recorded here so the deadline is understood as a symptom.

---

## Step 0 — the things that must be true first

**This is the checklist the four blocking issues were written for.** Work down it; each item
links to the issue that explains it properly.

### 0.1 — the WAF rate-limiting rule must be live

> **⚙️ Ops**

**[#19](https://github.com/southville-running-club/src-website/issues/19). Do this one first
and do not skip it.**

`entries.create_pending_purchase()` is granted to `anon`, the anon key is published in page
source by design, and every successful call holds a place for 31 minutes. A single script
drains the field in one pass and keeps it drained by re-running every half hour — and it does
not even need a script, because the form takes an ordinary cross-site `POST`.

**A held place is indistinguishable from a real runner's**, so there is no query that cleans it
up, and every remedy available on the day lands on real entrants too.

**The rule is written down, and it is not written down here.** Its expression, threshold,
period, action and mitigation are [in the committed copy of the Cloudflare
rules](../../reference/cloudflare-waf-rules.md), where it is **E1** — beside **A1**–**A4**,
the account rules [#64](https://github.com/southville-running-club/src-website/issues/64)
adds for sign-in, sign-up, password reset and the admin surfaces. One table, because they are
the same kind of object in the same dashboard and the free plan may only allow one of them.

**One correction that file makes to this step, and it matters:** #19 says `POST /nn/` because
it was written before [ADR-011](../../architecture/decisions/adr-011-a-race-and-its-runnings.md)
split the pages. `POST /nn/` is now the *interest* form; **`POST /nn/2026/` is the entry form,
and that is the one that holds places.** E1 matches the prefix for that reason — a rule
written to the letter of the issue would cover the harmless half and miss the expensive one.

- [ ] **E1** is **live and tested** — created from
      [the table](../../reference/cloudflare-waf-rules.md#the-rules), then read back from the
      dashboard and diffed against it
- [ ] `POST /nn/stripe-webhook` is **excluded** from it, deliberately. Stripe's delivery
      volume is not a person's, and a block there stops a payment being *recorded* rather
      than stopping one being taken
- [ ] Consider covering the anon-callable `entries.expire_pending_holds()` and any health
      endpoints the platform exposes by then. Neither is abusable for correctness; both are
      free-tier compute anybody can spend
- [ ] The rule is recorded in [`apps/main/README.md`](../../../platform/apps/main/README.md)'s
      manual-steps table — that file already says a WAF rule *"is a manual step and belongs
      here when it happens"* — and its status column in the rules file says it is live

### 0.2 — somebody is watching the attention alarm

> **⚙️ Ops**

**[#20](https://github.com/southville-running-club/src-website/issues/20).** The alarm fires
when somebody has paid and has no place. It is a `console.error` in the Cloudflare
observability panel, which is a place a person has to decide to open.

- [ ] Either a channel that reaches a person without them choosing to look, **or** a standing
      daily reminder on both volunteers to run the query in
      [the attention runbook](entries-attention.md)
- [ ] **`/nn/admin` is not that channel and does not close this.** It counts unresolved flags at
      the top of the entries list, which makes the check a page rather than a SQL query — but it
      is still somewhere a person has to decide to look. Switching it on is worth doing before
      entries open ([the admin runbook](entries-admin.md)); it is not a substitute for either
      option above
- [ ] Whichever it is, it is written into that runbook next to the diagnosis table
- [ ] If it is the reminder, it is **marked as an interim** so it is removed when the
      confirmation email makes it redundant, rather than left running as a second half-alarm

### 0.3 — a backup exists and a restore has been performed

> **⚙️ Ops**

**[#23 item 2](https://github.com/southville-running-club/src-website/issues/23).** Not "a
backup is configured" — a restore that somebody has actually carried out.

- [ ] **What the Supabase plan actually provides** has been checked rather than assumed.
      Automated backups and point-in-time recovery differ sharply between tiers, and a free
      tier's terms differing from what is recorded is its own
      [stop-and-ask](../../architecture/principles.md#stop-and-ask)
- [ ] A `pg_dump` step is in the deploy runbook for any migration touching `entries`
- [ ] **One restore has been carried out** into a local container. `./dev` makes rehearsing
      this nearly free, which is the argument for doing it rather than intending to
- [ ] Where a dump lives and who may reach it has an answer. A dump of `entries` is a file of
      special category data under UK GDPR Article 9

### 0.4 — the free place is not a dead end

> **🏁 Race pages**

**[#22](https://github.com/southville-running-club/src-website/issues/22), and largely answered
on 28 August 2026.** Stripe refuses a zero-total Checkout session, so nothing can be *sold* at
£0 — but a free place can now be **given**, and a guide no longer needs one at all.

- [x] **A visually impaired runner enters their guide on their own entry.** One payment, two
      people, and the guide takes one of the 250 —
      [ADR-022](../../architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md). The
      `vi_guide` fee still exists and is still uncompletable on its own; nobody has to use it
- [x] **Any other free place is assigned from `/admin/nn/`** by somebody holding
      `nn.entry.create` —
      [ADR-021](../../architecture/decisions/adr-021-a-place-can-be-given.md)
- [ ] The stop in `worker/nn-entry.ts` is **unchanged**. It is still the backstop for any fee
      that prices at zero on the public path, and nothing should be able to reach it now

### 0.4a — the Left Handed Giant discount code is known and given out

> **⚙️ Ops**

**22 places at 10% off an unaffiliated entry**, confirmed 28 August 2026. **The code already
exists** — it is minted by a migration and is not in the repository, which is public — so there
is nothing to generate. What there is, is telling somebody.

- [ ] The code has been read off `/admin/nn/` → **Discount codes**, and given to Left Handed Giant
- [ ] They have been told it is for the **unaffiliated** entry — it is refused against the
      affiliated one, deliberately, since an England Athletics registered member already has
      the cheaper price
- [ ] Somebody has used it once as far as the confirm screen, which shows what it takes off
      **without holding a place or spending a use**, to prove the whole path end to end
- [ ] The committee know the club nets **£16** rather than £18 on each of the 22, because the
      10% is £2 and the ARC levy is still owed on an unattached runner

Full detail, including watching it and withdrawing it:
[the discount-code runbook](entries-discount-codes.md).

### 0.5 — the governance prerequisites

> **🏛️ Committee**

From [the phases](../phases.md#prerequisites-for-the-payment-half). These are the committee's,
not the build's, and they sit on the critical path.

- [ ] **The entry terms are written**, and the form links to them rather than saying they are
      to be confirmed
- [ ] **A refund policy is written**, since money is being taken from the public
- [ ] **Data-protection advice** obtained
- [ ] **Treasurer-controlled payment arrangements** in place
- [ ] **The Stripe account is under the club identity**, and both volunteers can reach it

### 0.6 — the platform is actually wired up

> **⚙️ Ops**

- [ ] All [manual steps](../../../platform/apps/main/README.md#manual-steps) are done, including
      the **three Worker secrets** and the **Stripe dashboard endpoint**
- [ ] `npm run smoke` passes against production
- [ ] The privacy notice's four open decisions are settled, or the club is content that they
      still render "To be confirmed by the club"

---

### 0.7 — the confirmation email actually leaves the building

> **⚙️ Ops**

**[#73](https://github.com/southville-running-club/src-website/issues/73).** Entering now sends a
confirmation, and cancelling or transferring sends one too. **The failure is not silent and
nothing is lost** — an undeliverable message stays queued — but a runner who pays £18 and hears
nothing will email the club, and on the morning entries open that is the mail nobody has time
for.

- [ ] **A real confirmation has arrived at a real inbox**, from the £1 Tester entry in
      [step 2](#step-2--rehearse-a-real-payment-without-opening-the-window). This is the only
      proof that counts — the same rule as `accounts-open.md` step 0.2, for the same reason:
      no local check can tell you the Worker secrets are right
- [ ] It came from **`nn@send.southvillerunningclub.co.uk`** and **pressing Reply reaches
      `nightingalenightmare@gmail.com`**. Unlike the account emails, these have a working
      `Reply-To`, and it is worth confirming once that it goes where it should
- [ ] **Cancelling that Tester entry produced a second email** saying it was refunded. Step 2
      cancels it anyway, so this costs nothing extra to check
- [ ] ⚠️ **Somebody understands the daily cap before the window opens.** Resend's free tier is
      **100 emails a day for the whole club account**, shared with every account confirmation
      and password reset, against **250 places**. On a busy first day the queue exceeds it and
      the rest arrive the following day — **late, never lost**. See
      [ADR-021](../../architecture/decisions/adr-021-the-club-tells-people-by-outbox.md), and
      [the email runbook](entries-email.md) is what to read when somebody asks
- [ ] **The plan the club is actually on is written down here, on the day.** The stated
      intention as of 28 August 2026 is **to pay for the first month and monitor** — around
      $20, priced in USD, not sterling. Nothing in the repository knows or cares which plan is
      live, so this checkbox is the only place it is recorded:

      Plan on 1 September 2026: ______________  Checked by: ______________

- [ ] ⚠️ **If the plan is paid, somebody owns the question of when it stops.** **There are two
      rushes and one month covers one of them**: entries close **17:00, Friday 30 October**,
      and a deadline is its own spike — as is a cluster of transfers in the fortnight before
      the race. Reverting to free in early October puts both back under 100/day. Either put a
      reminder in the calendar for the week of 26 October, or decide now to keep it paid
      through race day

---

## Step 1 — decide the window, from the committee

> **🏛️ Committee**

The two values come from the committee and from nowhere else. **Do not derive them, do not
round them to something tidier, and do not put a placeholder in while you wait.**

Write them here before you run anything, in `Europe/London`, and convert once.

**A proposal is on the table and it is not ratified.** The race director proposed these on
24 August 2026. They are written in below **because the conversion is the error-prone part and
it has been checked**, not because they are decided — the committee has not sat on them, and
until it has, this page's [stop conditions](#stop-conditions) still forbid step 3.

| | Local (`Europe/London`) | UTC to enter | Status |
| --- | --- | --- | --- |
| `entries_open_at` | Tue 1 Sep 2026, 07:00 BST | `2026-09-01T06:00:00Z` | **Proposed, not ratified** |
| `entries_close_at` | Fri 30 Oct 2026, 17:00 GMT | `2026-10-30T17:00:00Z` | **Proposed, not ratified** |

**The clocks go back on Sunday 25 October 2026** and the race is the weekend after, in GMT. If
the window spans that date, one of these two conversions differs from the other by an hour. It
is the single most likely mistake on this page — and this proposed window **does** span it,
which is why the two rows above carry different offsets: `07:00 → 06:00Z` in September, and
`17:00 → 17:00Z` in late October.

Both conversions are asserted in `packages/shared/tests/unit/london-time.test.ts` — one BST, one
GMT, and a third case that fails if a later edit ever gives them a single shared offset. **If
the committee ratifies different times, change that test with them**: it is what stops an hour
of drift arriving alongside the ratification, and a test still pinning the old pair would pass
while this page said something else.

`entries_close_at` may be left null if the committee has not set a closing time — the window is
then open until somebody closes it. It must be **after** `entries_open_at`; the table has a
check constraint that will refuse the reverse, which is the one mistake here that fails loudly.

---

## Step 2 — rehearse a real payment, without opening the window

> **👥 Both**

**Nothing has ever been paid for, in test mode or otherwise.** The first payment through this
chain should be a committee member's own card, not a stranger's.

**This step used to open the window on production for a few minutes and close it again.** It no
longer does, and the reason is worth stating: that made the rehearsal indistinguishable from the
real thing to anybody who happened to load the page during it, and it wrote a real
`entries_open_at` before the committee had ratified one — the exact value CLAUDE.md forbids
guessing. Issue #107 replaced it with a role.

### 2a — grant `nn-tester` to whoever is rehearsing

At `/admin/people/`, as a `super-admin`. It takes a minute and no deploy, and the page says what
the role carries: `nn.entry.before_open`, and nothing else. A tester cannot read the entry list.

### 2b — test mode first

1. In Stripe, confirm the account is in **test mode** and the endpoint is registered against
   the production URL, and that `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the Worker
   are the **test** pair. They must match each other — a live key with a test webhook secret
   fails signature verification on every delivery and the failure looks like an outage.
2. Signed in as the tester, open `/nn/2026/`. The entry form is there, above a notice saying
   entries are not open to the public. **Open it in a private window too**: signed out, the same
   address must say entries are not open. If it does not, stop.
3. Enter the race properly: real name, real details, the ordinary entry fee, all the way to
   Stripe.
4. Pay with a Stripe test card.
5. **Verify all four**, and stop if any is wrong:
   - `/nn/2026/entry/complete/` says the payment is confirmed and the place is booked
   - the purchase row is `paid`, with `attention` null
   - Stripe shows the payment, for the amount `entries.fees` says
   - the treasurer can see it
6. Check `/account/entries/` as the tester. The entry is listed, confirmed, with no medical note
   on it.
7. **Cancel it** from `/admin/nn/`, as a `super-admin`. Confirm the refund appears in Stripe,
   the row is `refunded`, and the place is back in the count on `/admin/nn/`.

### 2c — then live mode, for a pound

Test mode proves the integration. It does **not** prove the club's live account, its payout
settings, or that the live webhook endpoint is registered and reachable. That is what this
sub-step is for, and finding out on 1 September is finding out too late.

1. Swap `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the **live** pair
   (`wrangler secret put`, both, in that order — the endpoint's signing secret comes from the
   live-mode endpoint in the Stripe dashboard, which is a different endpoint from the test one
   and has to be registered separately).
2. Repeat 2b, choosing the **Tester (do not use)** entry type, which costs **£1**. It is
   visible only to somebody holding `nn.entry.before_open`. **Not a penny** — Stripe's minimum
   charge in GBP is £0.30, and a fee below it holds a place and then fails at the session
   call.
3. Pay with a real card.
4. Verify the same four things, plus: the money appears in the club's real Stripe balance and
   the payout schedule is what the treasurer expects.
5. **Cancel it**, and confirm the pound comes back.

### 2d — revoke the role

At `/admin/people/`. It takes effect on the tester's next request, with no session to end.

Leave the live keys installed — [step 3](#step-3--the-row-edit) is the next thing that happens,
and swapping them back to test keys before opening entries would take real money nowhere.

---

## Step 3 — the row edit

> **👥 Both**

**Both volunteers present.** One types, one reads it back before it runs.

**One column, not two.** The committee's ratified window is
**opens Tuesday 1 September 2026 07:00 BST, closes Friday 30 October 2026 17:00 GMT**, and
**the closing half is already applied** —
`20260827180000_nn_2026_entries_close_at.sql`. It is inert on its own, because `entry_state()`
tests `entries_open_at is null` as an explicit branch before it compares anything. So this step
sets the one column that opens the race, and touching `entries_close_at` again would be an
opportunity to get a date wrong for no gain.

**The offsets differ and that is not a typo.** The clocks go back at 02:00 on 25 October 2026,
between the two ends of the window: 07:00 BST is `06:00Z`, 17:00 GMT is `17:00Z`. Written with
an explicit `+01` below so it does not depend on the session's `TimeZone`.

```sql
update entries.events
   set entries_open_at = timestamptz '2026-09-01 07:00:00+01'   -- 07:00 BST = 06:00Z
 where slug = 'nn-2026'
returning slug, entries_open_at, entries_close_at, capacity, minimum_age;
```

Then read it back in the timezone a runner reads it in — **not** in UTC, where an hour out looks
identical to correct:

```sql
select entries_open_at  at time zone 'Europe/London' as opens_london,
       entries_close_at at time zone 'Europe/London' as closes_london
  from entries.events where slug = 'nn-2026';
```

**Both must read the wall-clock times, not the stored instants:** `opens_london` is
`2026-09-01 07:00` and `closes_london` is `2026-10-30 17:00`. `06:00` or `18:00` means the
offset was applied the wrong way round — stop, and set it again.

**Read the returned row.** `capacity` should be 250 and `minimum_age` 18. If either is not what
you expect, close the window immediately and find out why before anybody arrives.

There is no deploy, no cache to purge and nothing to restart. `/nn/` decides which form to show
per request, from this row.

---

## Step 4 — verify, from outside

> **🏁 Race pages**

Do all of these from a browser that has never seen the site, not from the SQL editor.

- [ ] `/nn/` shows the **entry form**, not the interest form
- [ ] The fees on it are £15 affiliated and £17 unaffiliated, matching `entries.fees`
- [ ] The primary button says "Enter the race"
- [ ] A deliberately invalid entry is refused with messages against the right fields
- [ ] **With JavaScript disabled**, the form still works
- [ ] `npm run smoke` passes
- [ ] The rate-limiting rule fires when you make it fire

---

## Step 5 — write down what happened

> **👥 Both**

Per the [pragmatic exception](../../foundations/requirements.md#everything-is-defined-as-code),
manual work is legitimate *because* it is recorded.

- [ ] Add a "what actually happened" section to the foot of this file: the date, the two
      timestamps as entered, who ran it, who read it back, and anything done differently
- [ ] Tick the boxes in [the phases](../phases.md#done-when)
- [ ] Close [#19](https://github.com/southville-running-club/src-website/issues/19),
      [#20](https://github.com/southville-running-club/src-website/issues/20),
      [#22](https://github.com/southville-running-club/src-website/issues/22) and
      [#24](https://github.com/southville-running-club/src-website/issues/24) if this run
      resolved them
- [ ] **Correct this runbook** where reality differed from it

---

## Closing entries again

The reverse is one statement and takes effect on the next request.

```sql
update entries.events set entries_open_at = null where slug = 'nn-2026';
```

`/nn/` falls back to the interest form. **Nothing already recorded is affected** — a `pending`
purchase keeps its hold and can still be paid, and the webhook still records it, because
`POST /nn/stripe-webhook` does not consult the window. That is deliberate: somebody who was on
the Stripe payment page when the window closed has already been quoted a price and must not
lose their money.

**This is the rollback for every step above**, and it is why the row edit is the last thing on
this page rather than the first.
