# The entry emails — what they are, and what to do when one does not arrive

> **Who this is for:** whichever volunteer is on when somebody says *"I entered and never heard
> anything."* It assumes no knowledge of the outbox beyond this page.

**The club sends four emails about an entry**, and it sends all of them through
[Resend](https://resend.com). They are the only email this platform sends about a race;
account emails — confirm your address, reset your password — are a different path with the
same provider, and [`accounts-open.md`](accounts-open.md) owns those.

| | Sent when | To |
| --- | --- | --- |
| **Confirmation** | The Stripe webhook records a payment | The address on the entry |
| **Cancelled** | A volunteer cancels and refunds an entry | The address on the entry |
| **Transferred away** | A place is moved to somebody else | The **previous** address |
| **Transferred to you** | The same moment | The **new** address |

---

## Start at `/admin/emails/`

**It answers almost every version of this question without a credential or a log.** The queue,
newest first, with what each message is about, whether it has gone, and how many times the club
has tried. **It is in the navigation bar** — *Emails*, beside Nightingale Nightmare — so it is
one click from the entry list rather than a link on the dashboard.

Reading it needs `nn.email.read`; the re-send button needs `nn.email.resend`. **`nn-admin`
carries both**, so in practice anybody who can read the entry list can read this. The two are
separate permissions as of 29 August 2026: the page used to ask `nn.entry.read` and
`nn.entry.cancel`, which meant a volunteer had to be trusted with refunds before they could
answer *"I never got my confirmation"*.

Find the person's address in the list. What you see decides the rest of this page:

| What the row says | What it means |
| --- | --- |
| **Sent** | The club sent it. **Ask them to check their spam folder** — this is the usual answer, and there is no button because a second identical copy is not the fix |
| **Waiting** | Owed and not gone yet. Nothing to do; it sends within about five minutes unless the cap is reached |
| **Failed** | Tried three times and stopped. This is the one with a **Send again** button |
| **Not in the list at all** | The club never owed it. That is not an email problem — go to [`entries-attention.md`](entries-attention.md), because it means the payment was not recorded |

⚠️ **"Sent today" on that page counts entry emails only.** Account emails — confirming an
address, resetting a password — go through the same Resend account and are not in this queue, so
the club's real usage against the daily cap is higher than the number shown.

---

## The one thing worth understanding

**Deciding to send and actually sending are separate, on purpose.** When somebody pays, the
database writes a row saying the club owes them an email — in the same transaction as the
payment itself. Nothing can lose that row. A separate job runs **every five minutes**, takes a
few rows at a time, and sends them.

So there are two different failures, and they need different responses:

- **The message was never owed.** The row does not exist. This is serious: it means the payment
  itself was not recorded, and the entry probably is not on `/admin/nn/` either. Go to
  [`entries-attention.md`](entries-attention.md) — the email is a symptom, not the problem.
- **The message was owed and has not gone yet.** The row exists and says `pending` or `failed`.
  This is the ordinary case, and the rest of this page is about it.

---

## First: is it the daily cap?

**Resend's free plan allows 100 emails a day for the whole club account**, shared between entry
emails and account emails. The race has **250 places**. On a busy entry day the club will hit
that ceiling, and this is expected rather than broken.

What happens when it does:

- Sending stops for the day. **Nothing is lost.** Every remaining message stays queued.
- The queue drains on its own once the cap resets, without anybody doing anything.
- People who entered later in the day get their confirmation **the next day**.

**The tell** is a log line saying Resend's daily cap was reached, and a pile of `pending` rows
whose attempt count is not climbing.

**What to do:** normally, nothing. Tell the runner their entry is safe and the email is on its
way. If this is happening on ordinary days rather than on the entry rush, the fix is to pay for
Resend's next tier — around $20 a month — rather than to keep waiting. That is a committee
decision, and it is recorded as an accepted risk in
[ADR-021](../../architecture/decisions/adr-021-the-club-tells-people-by-outbox.md).

---

## Second: has it failed three times?

A message gets **three attempts** before the club gives up on it and marks it `failed`. A
rate-limit rejection does not count as an attempt, so a capped day cannot exhaust them.

A `failed` message usually means one of:

| What it says | What it usually is |
| --- | --- |
| `http 422` | Resend rejected the address — a typo in what somebody typed |
| `http 401` / `http 403` | The Resend key is wrong, missing, or was rotated. **Every** message will fail |
| `TimeoutError` | Resend was unreachable. Usually clears by itself; re-send it |
| `unknown template …` | A deploy is mid-flight — the database knows a message the Worker does not. It clears itself if the deploy lands within about fifteen minutes; past that the message goes to `failed` and needs a re-send |

**A typo in an address cannot be fixed from the admin surface** — correcting an entry is still a
stop-and-ask. Email the runner from `nightingalenightmare@gmail.com` directly and tell them their
place is safe.

---

## Third: is anything sending at all?

If **every** message is queued and none has ever been sent, it is configuration rather than any
one entry. Two things have to be true, and neither is visible from the site:

1. **`RESEND_API_KEY` is set as a Worker secret** on `apps/main`. Manual step 12.
2. **`ENTRIES_WEBHOOK_KEY` is set as a Worker secret *and* its digest is installed in the
   database.** Manual step 3, both halves. The drain uses the same key as the Stripe webhook.

⚠️ **If payments are being recorded, the second one is fine** — it is the same key. So "entries
appear on `/admin/nn/` but no email ever sends" points at the first, and "nothing works at all"
points at the second.

Check the Worker's logs in the Cloudflare dashboard for a line naming
`entries.claim_outbox_batch`. It says which of the two it is.

---

## What you cannot do from here

- **Re-send a message that has already gone.** `/admin/emails/` refuses it, deliberately: the
  club cannot un-send an email, and the usual cause of "I never got it" is a spam folder. If
  somebody genuinely needs a second copy, forward it from the race mailbox — where it is
  obvious to them that a human did it.
- **Change what a message says.** The wording lives in `apps/main/worker/email.ts` and is a
  pull request.
- **Send somebody a message the club does not owe.** There is deliberately no way to compose
  one. Use the race's own mailbox.

---

## What is deliberately not sent

So nobody goes looking for it, or reports it as broken:

- **Nothing when a hold lapses.** Somebody who started an entry and did not pay is told nothing,
  because the club has taken nothing and has nothing to tell them about.
- **Nothing when somebody *asks* to cancel or transfer.** `request_entry_action()` records the
  ask; a volunteer acts on it, and the email goes when they do.
- **Nothing to the interest list.** That is a different list with a different consent.
