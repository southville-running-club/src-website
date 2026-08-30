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
| ~~**The rate-limiting rule is not live**~~ | **Met, and not by the rule this page used to name.** **C1** has been live since 25 August 2026 and covers `POST /nn/`, which is the prefix that matters. **E1 was never created and never will be** — see [step 0.1](#01--the-rate-limiting-rule-must-be-live). What is *not* met is that nobody has watched it fire, and that is a checkbox rather than a stop condition |
| **No payment has ever completed end to end** | [Step 2](#step-2--rehearse-a-real-payment-without-opening-the-window). The first real payment must not be a stranger's |
| ~~**The entry terms have not been written**~~ | **Met.** Published 28 August 2026 at [`/nn/2026/terms/`](https://new.southvillerunningclub.co.uk/nn/2026/terms/) and linked from the acceptance checkbox — #142. The race director's copy, verbatim. **The committee has not ratified it**, which is why the page says "Supplied by the race director" rather than claiming otherwise; that is a known state, not a blocker |
| **Nobody has restored a backup** | [#23 item 2](https://github.com/southville-running-club/src-website/issues/23). The rows about to arrive include dates of birth, emergency contacts and — under separate consent — medical notes |

---

## ⏰ Nobody has to be awake at 07:00, and that is new

**This section used to say the opposite, and it was wrong about the mechanism.** It read *"this
is a diary entry, not a deploy — one volunteer awake before 07:00"*. That is not what the column
does.

**`entries_open_at` is a scheduled switch, not a manual one.** `entries.entry_state()` resolves
the state by comparing the clock to it:

```sql
when event.entries_open_at is null              then 'pre_open'
when pg_catalog.now() < event.entries_open_at   then 'pre_open'
when ... >= event.entries_close_at              then 'closed'
else 'open'
```

`create_pending_purchase()` guards the same way independently, through its own `v_early` branch.
So **setting the column to Tuesday 07:00 at any point beforehand opens the race at Tuesday
07:00**, on its own, with no cron, no deploy and nobody present. Two separate reads, so they
cannot drift apart.

**Three things this changes, and the second is the one to hold on to:**

1. **The page and the database stop disagreeing.** `/nn/2026/` publishes 07:00 Tuesday from
   `race.json` while `entries_open_at` says *never*. Nothing reads both, so nothing can notice —
   there is no alarm, no log line, and until now no failing test. Scheduling the column closes
   that gap rather than racing it. `entries-window-published.test.ts` is the test that now fails
   if the two ever disagree again.
2. ⚠️ **The gate moves earlier, and it moves onto you.** Once this statement is run there is
   nothing between the clock and 250 places going on sale. **Everything in
   [step 0](#step-0--the-things-that-must-be-true-first) must be true before you type it**, not
   before 07:00. That is the whole cost of the convenience.
3. **Somebody still looks on Tuesday morning** — at 07:05, not 06:45, and to confirm rather than
   to act. Load `/nn/2026/` in a browser that has never seen it and check the entry form is
   there.

**The rollback is unchanged and still one statement**, and it works before, at, and after 07:00.
See [closing entries again](#closing-entries-again).

**If it is already past 07:00 and the column was never set**, run it anyway and then check
`/admin/nn/` for interest sign-ups that arrived in the gap: those are people who tried to enter
and could not, and they are the ones to tell first.

The two statements are in [step 3](#step-3--schedule-the-opening), and repeated here so that
whoever is running it is not scrolling for them:

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

**The permanent fix is still to publish from the database rather than from `race.json`**, which
deletes the second source instead of testing that the two agree. That is an ADR after entries
open, not a change to make in the week before — recorded here so the test is understood as a
guard rather than as the answer.

---

## Step 0 — the things that must be true first

**This is the checklist the four blocking issues were written for.** Work down it; each item
links to the issue that explains it properly.

### 0.1 — the rate-limiting rule must be live

> **⚙️ Ops**

**[#19](https://github.com/southville-running-club/src-website/issues/19), and it is met —
by a different rule from the one this step used to ask for.**

⚠️ **Do not go looking for `E1`. It does not exist and it is not going to.** This step named it
until 30 August 2026, and somebody following the old wording at 07:00 on a Tuesday would have
found no such rule in the dashboard and either halted the run or created a second rule the free
plan does not allow. **What is live is `C1`**, created 25 August 2026 — one combined expression
over every `POST` under `/account/`, `/admin/` and `/nn/`, excluding `/nn/stripe-webhook`.
It covers this step's concern because `/nn/` is a prefix and `POST /nn/2026/` is underneath it.

`entries.create_pending_purchase()` is granted to `anon`, the anon key is published in page
source by design, and every successful call holds a place for 31 minutes. A single script
drains the field in one pass and keeps it drained by re-running every half hour — and it does
not even need a script, because the form takes an ordinary cross-site `POST`.

**A held place is indistinguishable from a real runner's**, so there is no query that cleans it
up, and every remedy available on the day lands on real entrants too.

**The rule is written down, and it is not written down here.** Its expression, threshold,
period, action and mitigation are [in the committed copy of the Cloudflare
rules](../../reference/cloudflare-waf-rules.md). That file carries **E1** and **A1**–**A4** as
well, and **every one of those five rows says "superseded by C1"** — they are the argument that
was made, kept because they become reachable the day somebody pays for a plan, not a list of
things to create.

**The `POST /nn/` correction still stands and is why the prefix matters.** #19 said `POST /nn/`
because it was written before
[ADR-011](../../architecture/decisions/adr-011-a-race-and-its-runnings.md) split the pages.
`POST /nn/` is now the *interest* form; **`POST /nn/2026/` is the entry form, and that is the one
that holds places.** C1 matches on the prefix, so it covers both — a rule written to the letter
of the issue would have covered the harmless half and missed the expensive one.

**What C1 buys, and what it does not.** At 3 requests per 10 seconds it caps one address at 18
entry attempts a minute, which is a real brake on the throughput attack this step exists for.
The 10-second mitigation is the most the free plan offers, so it is a burst brake rather than a
cost to an attacker. [The rules file](../../reference/cloudflare-waf-rules.md#what-actually-happened)
argues that trade in full; it is recorded, not overlooked.

- [x] **C1 is live** — created 25 August 2026, named `Combined — account, admin and race forms`
      in the dashboard, execution order first, status Active
- [x] `POST /nn/stripe-webhook` is **excluded** from it, deliberately. Stripe's delivery
      volume is not a person's, and a block there stops a payment being *recorded* rather
      than stopping one being taken
- [ ] ⚠️ **Somebody has watched it fire.** Still outstanding, and it is the one box on this step
      that is not ticked — [accounts-open step 0.3](accounts-open.md#03--somebody-has-actually-tried-it).
      Four rapid `POST`s from one address should be blocked; nobody has confirmed what the
      blocked person actually sees, because it is Cloudflare's page rather than the club's
- [ ] ⚠️ **Expect at least one report of a legitimate block on opening morning**, and know in
      advance that it is not a fault. A mobile carrier puts hundreds of subscribers behind one
      address and 07:00 is when a group of them submits at once. The 10-second mitigation means
      somebody blocked is through again before they have finished reading the page — **do not
      loosen the rule on the day** without reading the rules file first
- [ ] Consider covering the anon-callable `entries.expire_pending_holds()` and any health
      endpoints the platform exposes by then. Neither is abusable for correctness; both are
      free-tier compute anybody can spend
- [x] The rule is recorded in [`apps/main/README.md`](../../../platform/apps/main/README.md)'s
      manual-steps table as step 11, marked **Partly done**, and its status column in the rules
      file says it is live

### 0.2 — somebody is watching the attention alarm

> **⚙️ Ops**

**[#20](https://github.com/southville-running-club/src-website/issues/20).** The alarm fires
when somebody has paid and has no place. It is a `console.error` in the Cloudflare
observability panel, which is a place a person has to decide to open.

**Decided on 30 August 2026: the standing daily reminder, explicitly as an interim.** The
alternative — the cron sending "N purchases need a human" through the outbox #73 built — is the
better answer and was not taken before Tuesday, because it is new sending behaviour on the path
the confirmation emails depend on, two days before the club's first public transaction. **The
procedure and the reasoning are in [the attention runbook](entries-attention.md#-the-interim-agreed-30-august-2026--a-daily-reminder-and-it-is-not-the-answer)**;
these are the boxes for the day.

- [ ] **The reminder exists in both volunteers' own calendars**, daily from 1 September to 30
      October — one each, not a shared entry one person assumes the other has seen
- [ ] The entry is **marked interim and links to #20**, so whoever deletes it knows what has to
      exist first
- [ ] **On the first day it is checked twice**, mid-morning and end of day
- [ ] **`/admin/nn/` is not that channel and does not close this.** It counts unresolved flags at
      the top of the entries list, which makes the check a page rather than a SQL query — but it
      is still somewhere a person has to decide to look. It is a good place to go once something
      has prompted you; it is not the prompt

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

**25 places at 10% off an unaffiliated entry**, confirmed 28 August 2026 and **raised from 22 to
25 on 30 August 2026**
([#157](https://github.com/southville-running-club/src-website/issues/157)).
**The code already exists** — it is minted by a migration and is not in the repository, which
is public — so there is nothing to generate. What there is, is telling somebody.

**The allocation is a migration rather than a step on this list.**
`20260830120000_nn_2026_lhg_twenty_five_places.sql` raises it everywhere, so there is nothing to
run by hand and nothing that can be true of production and false of a laptop. Reading the panel
below is a confirmation, not the change.

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
- [ ] **The published privacy notice is the committee's current wording.** **This asked
      about four open decisions until 30 August 2026**, when the club instructed that
      `/nn/privacy/` reproduce the committee's document word for word. That document
      answers all four, so the page renders no "To be confirmed by the club" marker at all
      and `nn-privacy.spec.ts` asserts zero. What is left to check on the day is that no
      newer document has been supplied — new wording is published by replacing that page,
      never by editing it
- [ ] ⚠️ **The club accepts that the notice states no medical-note retention period.** The
      committee's document says only that information is kept for as long as reasonably
      necessary. **The deletion is unchanged** — `entries.events.medical_retention` is one
      month and the five-minute cron still applies it — so the enforcement is stricter than
      the published words, which is the safe direction of the two. `race.json`'s
      `medicalRetention` still reads "One month after the race" and
      `packages/db/tests/entries-retention.test.ts` still ties it to the column, but that tie
      no longer reaches anything a runner reads

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

Leave the live keys installed — [step 3](#step-3--schedule-the-opening) is the next thing that happens,
and swapping them back to test keys before opening entries would take real money nowhere.

---

## Step 3 — schedule the opening

> **👥 Both**

**Both volunteers present.** One types, one reads it back before it runs.

⚠️ **This is the moment, not 07:00 on Tuesday.** The column is a scheduled switch — see
[the section above](#-nobody-has-to-be-awake-at-0700-and-that-is-new) — so the race opens by
itself at the time you write here. **Once this runs there is nothing between the clock and 250
places going on sale**, so do not run it until every box in
[step 0](#step-0--the-things-that-must-be-true-first) is ticked and
[step 2](#step-2--rehearse-a-real-payment-without-opening-the-window)'s pound has been taken and
refunded.

**Running it early is the point, and Monday evening is the intent.** It buys daylight: if the
read-back is wrong you find out with a day in hand rather than at 07:04 with runners arriving.

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

Do all of these from a browser that has never seen the site, not from the SQL editor. **A
private window is not enough on its own** — the entry pages are `private, no-store` since #146,
but an edge object cached before that deploy can still be served, so hard-reload if anything
looks like the state you were in a minute ago.

**Three things on this list were wrong until 30 August 2026**, and all three would have been
read out loud at 07:00 by somebody trusting the page:

- [ ] **`/nn/2026/`** shows the **entry form**, not the interest form. **Not `/nn/`** — that page
      is evergreen, names no year, and carries no form at all since
      [ADR-011](../../architecture/decisions/adr-011-a-race-and-its-runnings.md); a `POST` to it
      falls through to the assets binding and answers 405
- [ ] The fees on it are **£18 affiliated and £20 unaffiliated**, matching `entries.fees`.
      Revised from £15/£17 on 24 August 2026 —
      [decision 006](../../decisions/decision-log.md). The £2 gap is ARC's Unattached Runner
      Levy, so the club nets £18 either way
- [ ] `/nn/` still shows the **interest** form and still names no year, and its year panel
      points at `/nn/2026/`
- [ ] The primary button says "Enter the race"
- [ ] The ARC permit number **`ARC/26/0842`** is on the page and at the foot of the form
- [ ] A deliberately invalid entry is refused with messages against the right fields
- [ ] **With JavaScript disabled**, the form still works — this is the one that has broken twice
- [ ] Entering twice with the same name and date of birth is refused with *"This runner already
      has a place"*, and the response is **409**, not 503
- [ ] `npm run smoke` passes
- [ ] The rate-limiting rule fires when you make it fire — four rapid `POST`s from one address.
      **This also closes [step 0.1](#01--the-rate-limiting-rule-must-be-live)'s open box**, so
      write down what the blocked page actually said

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
