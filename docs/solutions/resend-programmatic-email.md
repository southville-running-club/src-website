# Programmatic email with Resend

Design for **Problem 2** in [email](email.md#problem-2--programmatic-mail): the automated
mail an entry form or sign-up sends back to a member. Not a decision by itself — it fills
in the detail that document left open once the five Fasthosts role addresses were chosen,
and it should be read alongside it, not instead of it.

---

## The five addresses, and which problem each belongs to

Five Fasthosts mailboxes, agreed: **`admin`, `info`, `welfare`, `secretary`, `payments`**.
All five are [Problem 1](email.md#problem-1--human-mailboxes) — real mailboxes, read by a
person, replied to from Gmail via *Send mail as*. `admin` is already in use for website
administration. The other four are new.

**None of the five should be the `From` address on automated mail.** That is the mistake
[email.md](email.md#two-problems-and-one-purchase-will-not-solve-both) already names:
mixing programmatic volume into a human inbox's sending reputation risks the mailbox that
holds it. Resend sends *as* the club without going anywhere near these mailboxes — it needs
its own identity, on its own subdomain, and the two only meet at `Reply-To`.

| Fasthosts mailbox | Who reads it | Resend touches it? |
| --- | --- | --- |
| `admin` | Web/tech admin | No |
| `info` | General enquiries | Only as a `Reply-To` target |
| `welfare` | Welfare officer | Not by default — see below |
| `secretary` | Club secretary | Not by default — see below |
| `payments` | Treasurer | Not by default — see below |

`info` is the right general-purpose `Reply-To` for anything that does not obviously belong
to one of the other four — that is what "generic access" means in practice: a human reads
replies there, not that Resend sends as `info@`.

### Should `info@` just be the one `Reply-To` for everything Resend sends?

Worth deciding explicitly, because the alternative — routing replies to `payments@` for
entry confirmations, `welfare@` for welfare-flagged mail, `info@` for the rest — is more
precise but also more to keep straight across every template, and a mistake there is a
reply landing nowhere anyone checks.

**Defaulting every automated `Reply-To` to `info@` is the simpler, safer starting point.**
`info` is explicitly the generic-access mailbox and is genuinely read by a person — a
member who hits "reply" on a confirmation email is not choosing a department, they are
replying to "the club", and `info@` is what that maps to. Routing straight to `payments@`
or `welfare@` only pays off once a specific flow (a failed payment, a welfare disclosure at
sign-up) is common enough that skipping a forward from `info` actually matters. Until then,
one destination for all Resend replies is one fewer thing to get wrong, and `info@` reads
naturally as "the club replied."

**Start with `info@` as the only `Reply-To`.** Move a specific flow to its own mailbox only
once volume or sensitivity (welfare disclosures, in particular) makes a direct line worth
the extra template complexity — treat that as a later, deliberate change, not part of this
design.

---

## What Resend actually sends as

**A dedicated sending subdomain**, per email.md's existing recommendation:
`send.southvillerunningclub.co.uk`. Not `mail.` — that is the MX target for the mailboxes
above — and not the bare domain, so a bad run of application mail can never touch the
domain's core SPF/DKIM/DMARC posture.

The `From` address is chosen per context, not per mailbox:

| Context | Suggested `From` | `Reply-To` |
| --- | --- | --- |
| Nightingale Nightmare entries | `nn@send.southvillerunningclub.co.uk` | `info@` |
| Pass the Buck entries | `pass-the-buck@send.southvillerunningclub.co.uk` | `info@` |
| General sign-up / intake forms | `noreply@send.southvillerunningclub.co.uk` | `info@` |

(See [below](#should-info-just-be-the-one-reply-to-for-everything-resend-sends) for why
every row defaults to the same mailbox rather than routing per context.)

This is what makes automated mail "look like it's from `nn` or `pass-the-buck`" without
inventing new mailboxes: the display name and local part are chosen by the sending code,
Resend just needs the subdomain verified once. Adding a new race or form later is a code
change (a new `From`), not a new DNS record or a new Fasthosts purchase.

**Set the display name too** — `From: "Nightingale Nightmare" <nn@send.southville...>` —
since that is what most inboxes actually show.

---

## DNS: additive only

Verifying `send.southvillerunningclub.co.uk` in Resend adds records under that subdomain.
None of it touches an existing record — this is [Move
1](dns-and-domain.md#move-1--add-a-record-no-risk) in the DNS document, no risk, reversible
by deleting the records.

- **SPF**: an `include:` added to the zone's *existing* record, not a replacement —
  `v=spf1 mx a include:_spf.livemail.co.uk include:_spf.resend.com/amazonses.com ~all`
  (Resend publishes the exact value at verification time). Mind the **10-DNS-lookup
  limit** — email.md already flags dropping the unused `a` mechanism to make room.
- **DKIM**: one or more CNAMEs Resend provides, scoped to the `send.` subdomain, e.g.
  `resend._domainkey.send.southvillerunningclub.co.uk`.
- **DMARC**: the existing `_dmarc` TXT at `p=none` already covers subdomains by default
  (no `sp=` override in the current record) — no change needed there.

The exact record values come from Resend's dashboard at verification time and should be
captured in this document once known, the same way the current zone is captured in
[current state](../foundations/current-state.md#dns-and-email).

---

## Free tier: will it work?

**Yes, to start**, per [email.md](email.md#problem-2--programmatic-mail)'s existing
figures — 3,000/month, but a **hard cap of 100/day** is the number that actually matters.
Five sending identities share one account-wide cap, not one each, so `nn@`, `pass-the-buck@`
and any future `noreply@` all draw from the same 100.

That is comfortable most of the year and tight on a single entry-rush day (email.md cites
~150 solo Nightingale Nightmare entries as the scenario that could hit it). **Check actual
sent volume before this is built** — the club's Gmail accounts already show typical daily
mail counts.

If the cap bites: **Amazon SES** is already the named fallback, at roughly 50p/year for the
club's volume, more setup, and a sandbox-exit request. Migrating means swapping an
`include:` and a set of DKIM records — no mailbox is affected, because SES only ever
touches Problem 2.

---

## What this is not

- **Not a mailbox purchase.** Buying `info`, `welfare`, `secretary`, `payments` at
  Fasthosts is [Problem 1](email.md#problem-1--human-mailboxes) — its own decision, its own
  ~£26–33/yr, unrelated to Resend's £0.
- **Not a code change yet.** This is the design; wiring a Resend send call into an entry or
  intake handler, and adding `RESEND_API_KEY` as a Worker secret, is separate work once the
  sending subdomain is verified.
- **Not touching the timing platform.** `pass-the-buck` and `nn` here are sending
  *identities* for club-site confirmation email, not `src-race-timing` — that stays
  untouched per [principles](../architecture/principles.md).

---

## If this were decided

| | |
| --- | --- |
| **Requirement** | [C8](../foundations/requirements.md#c8--send-email-as-the-club) |
| **Blocked on** | Choosing which four new Fasthosts mailboxes to buy (recorded above as `info`, `welfare`, `secretary`, `payments`) and verifying the `send.` subdomain in Resend |
| **Decision** | Resend, free tier, on `send.southvillerunningclub.co.uk`; `From` chosen per context (`nn@`, `pass-the-buck@`, `noreply@`); `Reply-To` set to the relevant Fasthosts role mailbox |
| **Cost** | £0, on top of the ~£30/yr already costed for the four mailboxes in [email.md](email.md#cost) |
| **Exit cost** | Low — swap an `include:` and a set of DKIM records; no data held that needs migrating |
| **Revisit when** | The 100/day cap is hit, or a sixth sending identity is needed |
