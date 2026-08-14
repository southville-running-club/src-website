# Privacy notice — Nightingale Nightmare 2026

**DRAFT FOR COMMITTEE APPROVAL — not yet published**

Prepared 14 August 2026. Sections marked **[DECISION]** need the committee to choose
before this can go live. Everything else is drafted from what the entry system actually
does and from the club's own 2023 practice.

This is a draft by a volunteer, not legal advice. If the club wants it checked by
someone qualified, that is a reasonable thing to do before entries open — but a draft
in front of a committee is worth more than a blank page, and this covers the ground the
ICO expects.

---

## Built on 14 August 2026, and where it differs from this draft

**This document is the record of what the committee approved, and it is left as it was
approved.** The page is `apps/main/src/pages/nn/privacy.astro`. Five changes were made
building it, all of them checked against the schema rather than decided:

| Change | Why |
| --- | --- |
| **Four rows added to section 2**, and one to section 3 | This draft listed what somebody *types*. `entries.entry_purchases` also holds the fee and amount, Stripe's session and payment-intent references, the consents with their `consent_version`, and `created_at` / `hold_expires_at` / `paid_at`. **None of those was listed, and under-listing what a controller processes is a defect in a notice.** The added rows and the one lawful basis for the payment record are derived from the tables, not approved by anyone — they go to the committee with the four decisions below |
| **Section 2's closing sentence rewritten** | "We do not collect anything about you that you have not typed into the form" was not true: the payment reference, the timestamps and the consent version are recorded and none is typed |
| **"and nothing more" softened**, section 2 | Stripe also returns the session id, payment-intent id, currency and event type. The substance — no card data — is unchanged and verified |
| **The Resend line removed**, section 5 | On this draft's own instruction. There is no confirmation email, and naming a processor the club does not use is a claim about a data flow that does not happen |
| **"We keep everything inside the UK and the European Economic Area" cut**, section 5 | Nothing in the repository supports it, and it is in tension with the same section naming Stripe. Cut rather than asserted. **Worth raising with whoever checks this professionally** — it is the one gap the build could not close |

**Added rather than changed:** the interest form's `created_at`. This draft dropped it and
the page it replaced disclosed it, so leaving it out would have been a regression against
what the club had already published.

**Unchanged and still open:** the four **[DECISION]** items. They are `null` under
`race.json`'s `privacy` key and render "To be confirmed by the club"; filling one in is a
one-line edit there. The registered office, the company number, the controller and the
one-month medical retention are written in as settled.

**Also still true:** the entry terms do not exist, and the terms checkbox deliberately links
to nothing rather than to a page that is not there.

---

## Why this exists at all

Until now the club took entries through Full On Sport, and entrants were covered by
*their* privacy policy. There has never been a club-written data clause — we checked
every published Nightingale Nightmare page from 2017 to 2023 and none carries one.

From 2026 the club takes entries on its own system, so the club is the data controller
and needs its own notice. This is that notice. The pattern set here is the one every
future club form will copy, so it is worth getting right once.

---

## The notice

### 1. Who we are

Southville Running Club Ltd is the data controller for the information you give us when
you enter the Nightingale Nightmare, or when you ask to hear when entries open.

- **Registered office:** 1 Hengrove Farm, Hengrove Farm Lane, Bristol BS14 9DD
- **Registered in England and Wales**, company number ending 7549
- **Contact about your data:** **[DECISION — see below]**

If you are unhappy with how we have handled your information, please tell us first — we
would rather put it right. You also have the right to complain to the Information
Commissioner's Office at ico.org.uk, or on 0303 123 1113.

> **[DECISION 1] Who does someone write to?**
> In 2023 the answer was `nightingalenightmare@gmail.com`. Options:
> - Keep the race inbox. Simple, and it is already on the entry page.
> - Use a club address (e.g. an officer role rather than a person), which survives a
>   change of race director.
> - Name a person by role — "the Membership Secretary" — which is honest about who
>   actually handles it in a club this size.
>
> A postal address is also needed, and the registered office above works unless the
> committee prefers otherwise.

---

### 2. What we collect, and why

**If you ask to hear when entries open**, we collect your name and email address, and
we record that you agreed to us contacting you. We use it for one thing: a single email
when entries open. It is not a mailing list and we will not use it for anything else
without asking you again.

**If you enter the race**, we collect:

| What | Why we need it |
| --- | --- |
| Your name | To enter you, to put you on the start list, and to publish your result |
| Your email address | To send your confirmation and any information about race day |
| Your date of birth | To work out your age category, and to check you are 18 or over on race day |
| Your gender | Used with your date of birth to work out your category |
| Your running club, if you have one | Shown alongside your result, as is normal at a race |
| Your England Athletics number, if you claim the affiliated entry | To check the discounted entry is one you are entitled to |
| An emergency contact's name and phone number | So we can reach someone on your behalf if something happens on race day |
| Anything you tell us in the medical box | So our first aiders know, if they need to. This is optional — see section 4 |

We do not ask for anything else, and we do not collect anything about you that you have
not typed into the form.

**We never see your card details.** Payment is handled by Stripe, who take your card
information directly. We are told that a payment succeeded and for how much, and nothing
more.

---

### 3. What we are allowed to do with it, and why that is lawful

| What we do | Our lawful basis |
| --- | --- |
| Take your entry and give you a place | Performing our contract with you |
| Send you your confirmation and race-day information | Performing our contract with you |
| Work out your age category and place you in results | Performing our contract with you |
| Publish results — your name, club, category and time | Our legitimate interest in running a race and publishing its results, which is what entrants expect a race to do |
| Check an England Athletics number against the club's records | Our legitimate interest in charging the right entry fee |
| Contact your emergency contact if something happens to you | Protecting your vital interests |
| Keep records of who took part | Our legitimate interest in being able to answer questions about the event afterwards, including for insurance and our race permit |
| Email you when entries open, if you asked us to | Your consent, which you can withdraw at any time |
| Hold what you tell us in the medical box | Your explicit consent — see section 4 |

We do not use your information for marketing, we do not profile you, and nothing about
your entry is decided automatically in a way that affects you.

---

### 4. Medical information — handled separately, on purpose

Anything you write in the medical box is **special category data** under UK data
protection law, which means it gets more protection than the rest of your entry.

- **It is optional.** You can enter without it.
- **It is only held if you tick the box** giving explicit consent. If you leave that box
  unticked, nothing you typed is stored at all — it never reaches our records.
- **Who sees it:** the club's first aiders and the race organisers, on race day. Nobody
  else.
- **How long we keep it:** one month after the race, then it is deleted — separately
  from, and sooner than, the rest of your entry.
- It is held apart from the rest of your entry in our system, so deleting it is a single
  action rather than something anyone has to remember to do field by field.

---

### 5. Who else sees your information

We do not sell your information and we do not share it for marketing. It is seen by:

- **The club volunteers who run the race** — the entries, results and first aid teams.
- **Stripe**, who take your payment. They hold your card details; we do not.
- **Supabase**, who host our database. It is stored in London (AWS eu-west-2).
- **Resend**, who send our emails. *(Planned — remove this line if the confirmation
  email is not in place for 2026.)*
- **The public**, but only your name, club, category and finishing time, in the published
  results.

Our race is run under an ARC permit, so we may have to share limited details with the
permitting body if there is an incident.

We keep everything inside the UK and the European Economic Area.

---

### 6. How long we keep it

| What | How long | Why |
| --- | --- | --- |
| Medical notes | One month after the race | Only needed for race day and immediately afterwards |
| Your entry — name, contact, date of birth, emergency contact | **[DECISION 2]** | |
| Published results — name, club, category, time | Kept indefinitely | Results are the public record of a sporting event |
| Your email address, to tell you about next year's race | **[DECISION 3]** | |
| Interest-list sign-ups | Deleted once entries have opened and the email has been sent, unless you have entered | It exists to send one email |

> **[DECISION 2] How long do we keep entry records?**
> The 2023 practice was "one month after the race", after which only the email address
> was kept. That is short. Arguments for longer: an incident or insurance question can
> surface months later, and the ARC permit may carry a record-keeping expectation worth
> checking. A common answer for a club race is **12 months**, or **3 years** where
> insurance records are involved. The committee should pick a period and be able to say
> why.
>
> **[DECISION 3] Do we keep email addresses to contact people about next year?**
> 2023 said the club kept the email address indefinitely for this. Indefinite retention
> on a consent given years earlier is the weakest part of the old policy, and it is worth
> replacing with a stated period — **two years** is a common answer, after which we ask
> again. Note this also affects whether the club can contact 2023 entrants at all, given
> two years have already passed with no event.

When a retention period ends we delete the information, or strip out anything that
identifies you so that what is left is no longer about you.

---

### 7. Your rights

You can ask us to:

- give you a copy of what we hold about you;
- correct anything that is wrong;
- delete what we hold, where we no longer need it;
- stop or limit what we do with it;
- send it to you, or to someone else, in a portable form.

Where we rely on your consent — the interest list, and the medical box — you can
withdraw it at any time, and we will act on that.

Write to us using the contact in section 1. We may ask you to confirm who you are before
we hand over personal information, which is a protection for you rather than an obstacle.

### 8. Photographs

Photographs are taken at the race, including for the fancy dress competition, and are
used to show what the event is like. If you would rather not appear, tell us and we will
not use a photograph we know you are in.

> **[DECISION 4]** Confirm this reflects what the club actually does. In 2023 the fancy
> dress competition was judged from photographs taken at HQ, and past years mention free
> race photos — worth stating plainly whether photos are published, where, and for how
> long.

### 9. Changes to this notice

If we change how we use your information we will update this page, and we will tell you
directly if the change is one you would want to know about.

*Last updated: [date on publication]*

---

## What the committee needs to decide

1. **The contact** for data questions and removal requests — section 1.
2. **How long entry records are kept** — section 6.
3. **Whether email addresses are kept to contact people about next year**, and for how
   long — section 6. This also determines whether the club may contact 2023's entrants.
4. **What is true about photographs** — section 8.
5. **Whether to have this checked professionally.** Not required, but reasonable given
   the club is now a controller for medical data.

## Two things worth knowing while you decide

**The entry system is built to match this notice, not the other way round.** Medical
notes already live in their own table so a one-month deletion is a single operation; an
unticked medical consent box already means nothing is stored rather than stored and
filtered later. If the committee wants different retention, that is a configuration
change rather than a rebuild.

**Entries cannot open until this exists.** The entry form currently links to a notice
that says "to be confirmed" in three places, and the entry terms checkbox links to
nothing at all. Both need to be real before anyone pays.
