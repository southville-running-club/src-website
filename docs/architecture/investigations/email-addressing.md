# Email addressing

Which addresses the club has, where mail to each of them lands, and which one a given page
or a given piece of code is allowed to print.

There is already a document that costs the options ([email](../../solutions/email.md)) and
one that designs the transactional sender
([Resend](../../solutions/resend-programmatic-email.md)). Neither answers the question
somebody actually has in front of a diff — **what is true right now, and what may I put in
this footer** — which is what this page is for.

It sits beside [networking](networking.md) deliberately: the same zone carries the website
and the club's mail, so the two documents constrain each other.

---

## What was there before

**Forwarding only, into personal Gmail accounts.** Captured in the
[zone](../../foundations/current-state.md#dns-and-email) on 6 August 2026: addresses
existed on the domain, but no mailbox the club held. Every one of them was a Fasthosts
livemail forward pointing at a volunteer's Gmail.

Three consequences, and they are the reason
[decision 003](../../decisions/decision-log.md) exists:

| | |
| --- | --- |
| **Replies came from a volunteer** | Mail arrived *as* the club and was answered *as* a person. For a limited company taking entry money, a credibility problem rather than an inconvenience |
| **Forwarding breaks SPF** | The forwarding server is not authorised by the original sender's record, so forwarded mail fails authentication. Under `p=none` it degrades into spam folders — and the club could never tighten DMARC while it depended on forwarding |
| **One person could reach it** | No shared access and no archive. If the volunteer left, the destination and every message in it left too. It did not appear on the [access list](../../foundations/current-state.md#accounts-and-access) because it looked like a DNS record, not an account |

**Nightingale Nightmare had a fourth problem on top**: its published address was not on the
club domain at all. `nightingalenightmare@gmail.com` was in `race.json` and printed at the
foot of every `/nn` page — so the race's public contact point was a free mailbox on
somebody else's domain, outside anything the club could revoke, audit, or hand over.

---

## What is there now

**Five Fasthosts mailboxes, and aliases onto them.** The mailboxes are
[Problem 1](../../solutions/email.md#problem-1--human-mailboxes) — real inboxes, read by a
person, replied to from Gmail through *Send mail as* so the reply leaves from the club
address and is SPF-aligned.

| Mailbox | Who reads it |
| --- | --- |
| `admin@` | Web and tech administration. Already in use before the others existed |
| `info@` | **General enquiries.** The default destination for anything not obviously one of the other four |
| `welfare@` | Welfare officer |
| `secretary@` | Club secretary |
| `payments@` | Treasurer |

**Aliases are how a role gets an address without getting an inbox.** They cost nothing,
they need no MX change, and mail to one lands in a mailbox a human already opens. The rule
this follows is [email.md](../../solutions/email.md#the-recommendation)'s — *buy role
addresses, not people* — taken one step further: buy a mailbox only when somebody has to
read it separately.

| Alias | Forwards to | Published where |
| --- | --- | --- |
| `nightingalenightmare@` | `info@` | **Every `/nn` page**, from `race.contact` in `race.json` |
| `nn@` | `info@` | Nowhere. It exists so that a guess, or a reply to a Resend `nn@send.` message read carelessly, still arrives |

### Why the race publishes an alias rather than `info@` itself

`info@` would work and would be one fewer thing to configure. It is not what the pages
print, for two reasons.

**A race address survives being wrong.** If Nightingale Nightmare's mail ever needs to go
somewhere other than general enquiries — a race director's inbox during entry week, a
volunteer covering the fortnight before the event — that is a one-line change at Fasthosts
against an address already printed on flyers, race numbers and three years of email
threads. Publishing `info@` welds the race's routing to the club's.

**The local part carries the continuity.** `nightingalenightmare@` is the same word people
have been writing to for years; only the domain after it changed. Somebody re-reading an
old email or an old flyer gets an address that still reads right, and — once the Gmail
account is retired — mail sent to the old one is the club's problem to catch rather than a
silence nobody can see.

`nn@` exists for the opposite reason: it is short, it matches the `/nn` path and the
`nn@send.southvillerunningclub.co.uk` sender the
[Resend design](../../solutions/resend-programmatic-email.md#what-resend-actually-sends-as)
plans, and it costs nothing to reserve. It is deliberately not published — one address on
the pages, not two.

---

## Which address goes where

The distinction that matters, and the one that is easy to get backwards:

| | Address | Rule |
| --- | --- | --- |
| **What a page prints** | `race.contact` | **Never a literal in markup.** It is one string in `race.json` and every page reads it, which is what made this change a one-line diff rather than a hunt |
| **What automated mail is *from*** | `nn@send.southvillerunningclub.co.uk` | **Not a mailbox, and not one of the five.** A dedicated sending subdomain, so a bad run of application mail cannot touch the committee's reputation |
| **What automated mail *replies to*** | `info@` | The human end. [Resend](../../solutions/resend-programmatic-email.md#should-info-just-be-the-one-reply-to-for-everything-resend-sends) argues for one destination rather than routing per context |

**None of the five mailboxes is ever the `From` on automated mail.** That is the mistake
[email.md](../../solutions/email.md#two-problems-and-one-purchase-will-not-solve-both)
exists to prevent: programmatic volume sharing a reputation, and a sending limit, with the
inbox the committee depends on.

> **Today that rule is knowingly broken.** Resend's account and DNS are
> [now in place](../../solutions/resend-programmatic-email.md#current-status-account-and-dns-done-info-still-used-directly),
> but the Worker's own send call is not written yet, so `info@` still sends this
> programmatic mail directly in the meantime — tolerable only because there is no
> confirmation email yet and the volume is zero. **The first live entry is the trigger to
> build the Resend piece**, not a later tidy-up.

---

## What this did not change

Worth stating, because a change to an email address invites the assumption that mail moved.

- **No MX change.** Inbound mail routes exactly as it did.
- **No DNS record added, removed or edited.** An alias is a Fasthosts mailbox-configuration
  setting, not a zone entry — so this is not a [DNS change](../principles.md) and did not
  need the runbook that governs those.
- **DMARC is still `p=none`.** Tightening it is the reward for getting off forwarding
  entirely, and is its own change with its own observation window.
- **The Gmail account still exists.** Retiring it is a separate step, and it should be
  *forwarded* into `info@` before it is closed rather than closed outright — see the
  [runbook](../../delivery/runbooks/nn-email-aliases.md#stage-3--the-old-gmail-address).

---

## Revisit this when

- **The first live entry form takes a real submission** — the trigger to build Resend
  rather than send from `info@`.
- **Nightingale Nightmare wants its own reader.** At that point
  `nightingalenightmare@` stops being an alias and becomes a mailbox, which is a Fasthosts
  purchase and therefore a committee decision.
- **The registrar moves away from Fasthosts.** The mailboxes and every alias on them move
  with it, and [decision 003](../../decisions/decision-log.md)'s consolidation argument
  disappears.
