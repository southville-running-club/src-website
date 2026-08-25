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
| **The entry open and close times have not been supplied by the committee** | They are a [stop-and-ask](../../architecture/principles.md#stop-and-ask) fact. A plausible time typed in here is a published claim about when a race opens |
| **The rate-limiting rule is not live** | [Step 0.1](#01--the-waf-rate-limiting-rule-must-be-live). This is the only failure in the design with no recovery path |
| **No payment has ever completed end to end** | [Step 2](#step-2--rehearse-a-real-payment). The first real payment must not be a stranger's |
| **The entry terms have not been written** | The form asks people to accept terms; today its hint says they are still to be confirmed. Taking £17 against terms that do not exist is not a build decision |
| **Nobody has restored a backup** | [#23 item 2](https://github.com/southville-running-club/src-website/issues/23). The rows about to arrive include dates of birth, emergency contacts and — under separate consent — medical notes |

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

- [ ] A Cloudflare WAF rate-limiting rule on `POST /nn/` is **live and tested**
- [ ] Consider covering `POST /nn/stripe-webhook` and the anon-callable
      `entries.expire_pending_holds()` with the same rule, along with any health endpoints the
      platform exposes by then. None is abusable for correctness; all are free-tier compute
      anybody can spend
- [ ] The rule is recorded in [`apps/main/README.md`](../../../platform/apps/main/README.md)'s
      manual-steps table — that file already says a WAF rule *"is a manual step and belongs
      here when it happens"*

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

**[#22](https://github.com/southville-running-club/src-website/issues/22).** Stripe refuses a
zero-total Checkout session, so a visually impaired runner's guide cannot complete online —
and today they find that out *after* filling in fourteen fields.

- [ ] A guide learns the position **before** filling in the form, either by hiding the
      `vi_guide` fee and saying in prose how a guide enters, or by moving the notice to the
      point of selection
- [ ] The stop in `worker/nn-entry.ts` is **unchanged**. It is the backstop, including for a
      discount code that zeroes a fee that is not itself free

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

## Step 2 — rehearse a real payment

> **👥 Both**

**Nothing has ever been paid for, in test mode or otherwise.** The first payment through this
chain should be a committee member's own card, not a stranger's.

1. In Stripe, confirm the account is in **test mode** and the endpoint is registered against
   the production URL.
2. Open the window on production for the rehearsal — the same `update` as
   [step 3](#step-3--the-row-edit), with times a few minutes either side of now.
3. Enter the race properly: real name, real details, all the way to Stripe.
4. Pay with a Stripe test card.
5. **Verify all four**, and stop if any is wrong:
   - `/nn/entry/complete/` says the payment is confirmed and the place is booked
   - the purchase row is `paid`, with `attention` null
   - Stripe shows the payment, for the amount `entries.fees` says
   - the treasurer can see it
6. Close the window again (`entries_open_at = null`) and **delete the rehearsal rows**:

   ```sql
   -- The entrant and medical rows go with it; the foreign keys cascade.
   delete from entries.entry_purchases where id = '<the rehearsal purchase id>';
   ```

7. Refund the test payment in Stripe if it was a live-mode card.

---

## Step 3 — the row edit

> **👥 Both**

**Both volunteers present.** One types, one reads it back before it runs.

```sql
update entries.events
   set entries_open_at  = '2026-__-__ __:__:00+00',   -- UTC, from step 1
       entries_close_at = '2026-__-__ __:__:00+00'    -- UTC, or null
 where slug = 'nn-2026'
returning slug, entries_open_at, entries_close_at, capacity, minimum_age;
```

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
