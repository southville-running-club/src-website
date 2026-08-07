# Problem statement

Why the club is doing this at all.

Everything else in this repository — [requirements](requirements.md),
[options](../solutions/options.md), [priorities](../delivery/priorities.md) — exists to
answer the problems set out here. If a proposed change does not address one of them, it is
not in scope.

Derived from the club's [platform proposal](../reference/platform-proposal-v8.md) and from
the [current state](current-state.md) as observed.

---

## 1. The website costs too much for what it does

**£204 a year** for Squarespace, plus **£15.40** for the domain and DNS at Fasthosts.

The club is on the **middle tier, and cannot drop below it** — not because it needs the
website features, but because that tier is what permits taking payments. The club is
buying commerce capability and paying for a website plan to get it.

On top of the subscription, Squarespace **takes a fee of its own on every payment, layered
on top of the card processing fee**. On the £2.50 running-fee subscription and on event
payments, that is a percentage of a very small transaction, and the club absorbs all of it
— nobody uses the "cover the fees" option.

So the club pays three times on the same money: the plan, Squarespace's cut, and the card
fee.

## 2. It cannot do what the club needs

The club already owns a database holding **every crossing, every runner and every result**
from Pass the Buck 2026. Squarespace cannot reach it. So results are **transcribed onto a
web page by hand** after each race, and every year of history is a page somebody typed.

The same wall stands in front of everything else the club wants: race sign-ups that land
straight in a roster, entry pricing that checks a runner's registration, a members' area
that knows who is current, an archive that maintains itself.

## 3. Volunteers are doing work the system should do

This is the largest cost in the whole picture, and it does not appear on any invoice.

| Today | What it costs |
| --- | --- |
| WhatsApp community requests arrive as a form, then are **checked by hand against the membership records** | Membership Officer, every new member |
| New memberships and cancellations arrive as forms and are **processed manually** | Membership Officer, ongoing |
| Membership renewals happen **in England Athletics' portal**, not the club's systems | Members bounced between two places |
| Race results are **re-keyed** from the timing system onto a page | The whole results process, every race |
| Race entries arrive as a **CSV to import**, with data-quality problems worked around | Every race |
| Kit orders run through an **external link**, with stock tracked by hand on a page | Quarter Master |
| Newsletters are written in **Mailchimp and mirrored onto the site** by hand | Monthly — and the club is not keeping up |
| Event tickets and running fees are **reconciled manually** | Treasurer |

Every one of these is a volunteer doing something a system could do, and each is a place
where the club falls behind when somebody is busy. The newsletter archive is already
drifting for exactly this reason.

**The value of this programme is mostly here** — not in the £204.

## 4. Everything is a single point of failure

Not one point of failure: several, each resting on one person.

| System | Who can reach it |
| --- | --- |
| Fasthosts — domain, DNS, email forwarding | **One person** |
| Supabase and Vercel — the timing platform and its data | **One person** |
| England Athletics portal | **One person** |
| Squarespace | Several, with varying roles |
| Stripe | Treasurer and one other |

The club's race-day-critical software and its entire results archive are reachable by one
volunteer. Its domain and email are reachable by a different one. Neither can cover for
the other, and there is no shared ownership of anything.

The site itself compounds this: changes are made by clicking in a browser session. There
is no history of what changed, no review before it goes live, and no way to roll anything
back.

## 5. Three systems that do not talk to each other

The Squarespace site, the timing platform, and Mailchimp each hold part of the club's
information and none of them knows about the others. Membership records live partly in
England Athletics' portal. The £2.50 subscribers are a list in Squarespace that is **not
the membership list** and never has been.

Nothing joins up, so people do the joining.

## 6. Two races, one of them invisible

Nightingale Nightmare has **no web presence at all**. Pass the Buck has a page and two
years of hand-typed results.

## What the club is buying

**Lower fees** — but that is the smallest part of it.

**Volunteer time back.** Automating the manual chain above is where the real return is.

**Shared ownership.** Two people building it in the open, with the infrastructure defined
as code, means neither is a single point of failure and a third person can pick it up.
This is the difference between a club asset and a personal favour.

**The ability to change things.** Infrastructure as code, tested, reviewable, reversible —
so a change is something anyone can propose and verify rather than something one person
does by clicking. It also makes the platform legible to automated tooling, which is how
two volunteers with day jobs get to punch above their weight.

**Its own data.** Entrant records, results and membership under club control, in one
place, permanently.

---

## What would make this a failure

Worth stating, so success is not graded on a curve later:

- The club saves £204 and the manual work stays exactly as it is.
- The site becomes something only one person can change — the same failure with different
  technology.
- Committee members can no longer update their own pages and nothing replaces that.
- The results archive breaks, or a year of history is lost in the move.
- Members are lost during the payment migration.
- Club email stops and nobody notices.
