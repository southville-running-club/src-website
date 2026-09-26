# ADR-051: England Athletics is not a choice, so the form stops asking

**Status:** Accepted
**Date:** 26 September 2026
**Supersedes:** part of [ADR-050](adr-050-the-club-takes-an-application-and-tells-two-people.md) — the England Athletics consent question, and nothing else

## Context

[ADR-050](adr-050-the-club-takes-an-application-and-tells-two-people.md) built the membership
application form with this question, as a real yes/no:

> May we pass your name, date of birth and email address to England Athletics so they can set
> up your portal account?

and a hint beneath it:

> You can join the club either way. Saying no means you keep club membership without an England
> Athletics licence.

That ADR argued the question **had** to be refusable, in as many words: *"Consent that cannot be
withheld is not freely given, which is the whole of what UK GDPR asks of it."* The reasoning was
right. The premise was wrong.

**The club confirmed on 26 September 2026 how membership actually works.** Every new member is
processed on the England Athletics portal — including a £4 club-only one. That is how a
membership is set up, and **England Athletics is what emails the applicant the link to pay**.
The club takes no payment on its website at all.

## Decision

**The question comes off the form. The form states it instead.**

Passing the details on is not something the club asks permission for. It is how the club gives
somebody the membership they applied for, which makes the lawful basis the **contract** rather
than consent. UK GDPR asks that a person is *told* what happens to their details; it does not
ask their permission for something necessary to the thing they requested.

So the form says:

> **Your details go to England Athletics.** That is how your membership is set up, whichever
> one you chose, and it is England Athletics who will email you the link to pay. They decide
> what they do with your details themselves and have their own privacy notice.

## ⚠️ Why the old question was worse than no question

Not merely redundant — actively misleading, twice over:

1. **It was invalid consent.** A box that cannot be refused is not freely given, which is the
   test ADR-050 itself applied and then failed.
2. **Its hint stated something false.** *"Saying no means you keep club membership without an
   England Athletics licence"* told somebody their details stayed with the club. They did not.
   Anybody who answered "no" on that basis was misled about where their data went — which is
   the one thing a privacy question exists to get right.

A form that asks nothing tells the truth by omission. A form that asks and then ignores the
answer is worse than either.

## Consequences

**`ea_portal_consent` is nullable and is not dropped** — the expand step. The deployed Worker
still sends the key, and dropping the column mid-deploy would refuse every application between
the database deploying and Cloudflare catching up; the two are not sequenced against each other.
⚠️ **The contract step is owed** and is a migration that drops the column.

⚠️ **New applications record `null`, deliberately not `false`.** `false` reads as *"this person
refused"* — a statement about somebody who was never asked, and one nothing later could tell
apart from a real refusal. A null says "not asked", which is what happened.

**The club's notification email stops printing "May pass details: Yes."** Printing an answer
for somebody who was never asked would be the email inventing a fact about them.

**Three places stopped crediting the Membership Officer with the payment link** — the form's
submit note, the completion page and the acknowledgement email all said they would "be in touch
about paying". England Athletics sends it. The club is not in that loop, and a member waiting
for an email from the club would wait indefinitely.

**The form has seventeen fields, not eighteen.** `MEMBERSHIP_FIELDS` is the list, and a test
asserts `eaPortalConsent` is **not** on it — putting it back is a decision, not a fix.

**A submission still carrying the key is accepted and the key ignored.** Zod strips what the
shape does not name, which is what lets a Worker that still sends it work through the change.

## What this does not change

**ADR-050 stands in every other respect** — the table, the outbox, the two messages, the split
that gives the applicant's acknowledgement `details: null`, the two keys, and the retention
rule that never sweeps an application still marked `new`.

**The other three consent boxes are untouched.** The code of conduct, the privacy
acknowledgement and the disciplinary policy are all things a member genuinely agrees to, and
all three remain mandatory.

⚠️ **The retention promise is still one the club cannot keep.** Nothing marks an application
processed, so the 90-day clock never starts. `/admin/membership/` remains owed.
