# Runbook — a request about somebody's personal data

**Most of these need nobody.** Since [#62](https://github.com/southville-running-club/src-website/issues/62)
a person with an account can download everything the club holds about them, and delete their
account, from [`/account/data/`](../../../platform/apps/main/README.md#downloading-and-deleting-an-account--62)
— without asking, without waiting, and without a volunteer seeing their details in order to
hand them over.

**This page is for the ones that page cannot answer**, and there are only three shapes of
those: a request that reaches past the account into a race entry, a request from somebody who
has no account at all, and a request the club thinks it should refuse.

**Prerequisites:** the club's mailbox, and for anything touching entries, `/admin/nn/`. One
volunteer can do all of it. **Under an hour**, except where it waits on the other person.

---

## Who does which part

| Tag | Means | Today |
| --- | --- | --- |
| **⚙️ Ops** | The database, the admin surface, the exports | Mark |
| **✉️ Correspondence** | What the club writes back | Either |
| **🏛️ Committee** | A refusal, or anything with a legal test attached | Both, to agree |

---

## Stop conditions

| | Why it stops the run |
| --- | --- |
| **You cannot establish who is asking** | Acting on an unverified request is itself a disclosure. See [step 1](#step-1--confirm-who-is-asking) |
| **The request would delete a paid race entry** | [Step 3](#step-3--a-request-that-reaches-into-a-race-entry). That is a financial record with its own retention, and erasing one is not a volunteer's call |
| **You are minded to refuse** | 🏛️ A refusal has to be explained, and the person told they may complain to the ICO. Both volunteers agree it first |
| **The medical note is involved** | It is special category data. It is already deleted a month after the race by the cron, and reading one writes an audit row — do not read one to answer a question that does not need it |

---

## The clock

**One calendar month from the day the request arrives**, not from the day somebody gets to
it. It may be extended by two further months for a genuinely complex request, but the
extension has to be *told* to the person inside the first month, so a request nobody has
looked at for five weeks has already gone wrong.

**Write the date down when the request arrives.** That is the whole of the tracking this club
needs, and its absence is the only way this deadline is ever missed.

---

## Step 1 — confirm who is asking

✉️ **The point is not bureaucracy, it is that handing somebody's details to whoever asks for
them is the disclosure this process exists to prevent.**

If the request came from the address on the account, that is normally enough. If it did not,
reply **to the address on the account** rather than to the one that wrote in, and ask them to
confirm from there. Somebody who cannot reach that mailbox any more is not thereby refused —
they are asked for something else that matches what the club already holds.

**Do not ask for a passport or a driving licence.** Collecting a government identity document
to answer a question about a name and an email address collects far more than it settles.

## Step 2 — check whether the page already answers it

⚙️ **Ask this before anything else, because it usually does.**

| They asked for | Point them at |
| --- | --- |
| A copy of what the club holds | `/account/data/` — it downloads as a file, immediately |
| Their account deleted | `/account/data/` — the same page, and it names what stays before the button |
| A correction | `/account/details/` — they can change every field themselves |
| To stop hearing about next year's race | The interest list is its own record; ⚙️ remove them from `intake.nn_interest` |

Replying "here is where you do that yourself" is a complete answer to a rights request, and it
is a better one than doing it for them: they see everything, and nobody at the club has to
look at their details in order to hand them over.

## Step 3 — a request that reaches into a race entry

🏛️ **This is the one with a legal test attached, and it is the reason this page exists.**

Deleting an account does not delete a race entry, and `/account/data/` says so plainly before
the button. Somebody may nonetheless ask for the entry itself to go.

**It is not automatic, and it is not a volunteer's decision alone.** An entry is a financial
record of a transaction, kept for the club's own accounting, and the right to erasure does not
override a retention the club is separately obliged to keep. Equally, "we keep everything
forever" is not an answer either.

The questions to settle together, and to write the answers to in the reply:

1. **Has the race been run?** Before it has, an entry is closer to a live booking; after it,
   closer to an accounting record.
2. **What is actually being asked to go** — the entrant's name from a published start list, or
   the purchase record behind it? Those are different things and the first is usually the one
   that matters to the person.
3. **Is there a refund question tangled up in it?** If so it is a different decision
   entirely — a full refund on cancellation is settled
   ([ADR-018](../../architecture/decisions/adr-018-cancelling-an-entry.md)), but a partial
   refund is not, and the club has not settled it. Do not let a data request become the route
   by which that gets decided by accident. **Correction, 31 August 2026: this used to cite
   [#65](https://github.com/southville-running-club/src-website/issues/65), which is the
   member-accounts sign-in tracker and has nothing to do with refunds — removed rather than
   replaced with a guess.**

**The medical note is not part of this conversation.** It is deleted a month after the race
automatically, by the cron, and that is unchanged. **What is no longer true is that the club
has *published* that period.** Until 30 August 2026 this page said
[`/nn/privacy/`](../../../platform/apps/main/src/pages/nn/privacy.astro) published the
promise, and it did; on that day the club asked for the committee's own document to be
reproduced word for word, and that document neither mentions the medical box nor names a
period for it. Its section 6 says only that the club keeps information "for as long as
reasonably necessary" for the purposes it lists — a general statement, with no figure
anywhere on the page.

✉️ **So do not quote the notice as the source of the month**, because this is the
sentence most likely to be read back to the club by the person or by the ICO. The month
is **what the club does**; the notice is the general rule it does it under. If somebody
asks for it sooner, that is a plain yes — ⚙️ delete the row, and say it is done.

## Step 4 — somebody with no account

✉️ They are almost always on the interest list, or they entered a race.

⚙️ `/admin/nn/` reads both. **Export nothing wholesale to answer one person's question** —
find their rows, put what the club holds about *them* into the reply, and say what each field
is for. The three CSV exports exist for running the race, not for answering correspondence,
and one of them contains other people's special category data.

## Step 5 — reply, and record it

✉️ The reply says, in this order: what the club holds, why, how long it keeps it, what has
been done about the request, and — if anything was refused — **why, and that they may complain
to the Information Commissioner's Office**. The address and phone number are in
[the privacy notice](../../../platform/apps/main/src/pages/privacy.astro), section 1.

**Record it in the club's own files, not in this repository.** A note of who asked, when, what
was decided and when it was answered. That is the evidence the club acted, and it is the thing
an ICO enquiry would ask for. It does not belong in a git history, because it is itself
personal data.

---

## What this runbook deliberately does not do

**It is not an automated erasure pipeline**, and #62 is explicit about why: a request that
reaches beyond the account is a human decision with a legal test attached, and a button that
made it would be making that decision for the club, silently, every time.

**It is not the club's data-protection policy.** The policy is what
[`/privacy/`](../../../platform/apps/main/src/pages/privacy.astro) publishes. This is the
procedure that makes it true, and if the two ever disagree the notice is the one that is
binding on the club.

**Two things on that notice are still undecided**, and they are among the ones most likely to
be asked about: how long an account is kept, and whether deleting an account also deletes a
race entry by the same person. They render "To be confirmed by the club" and
`privacy.spec.ts`'s `OPEN_DECISIONS` asserts the exact count. **Until they are settled this
runbook is doing their job by hand** — which is workable for the handful of requests a running
club receives, and is not a reason to leave them open.
