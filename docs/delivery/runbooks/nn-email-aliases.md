# Runbook — the race's email aliases

Create two aliases on the club domain, both forwarding into `info@`, so Nightingale
Nightmare stops publishing a Gmail address.

| | |
| --- | --- |
| **Alias 1** | `nightingalenightmare@southvillerunningclub.co.uk` → `info@southvillerunningclub.co.uk` |
| **Alias 2** | `nn@southvillerunningclub.co.uk` → `info@southvillerunningclub.co.uk` |
| **Where** | Fasthosts control panel. **Not Cloudflare** |
| **Reverses in** | A minute. Delete the alias |
| **Why a runbook** | Fasthosts mailbox configuration is dashboard-only, and [any step done by hand is written down](../../../CLAUDE.md) |

The reasoning — why aliases and not mailboxes, why the race publishes its own address
rather than `info@` — is in
[email addressing](../../architecture/investigations/email-addressing.md). Do not
re-derive it here.

---

## Before you start

- You need the **Fasthosts account** that holds the club's mail package. It is the same
  account as the registrar, under the Web Manager's personal login —
  [a governance exposure already recorded](../../foundations/current-state.md#dns-and-email).
- **`info@southvillerunningclub.co.uk` must already exist and be read by somebody.** An
  alias onto a mailbox nobody opens is worse than the Gmail address, because at least
  somebody reads the Gmail.
- Know which Gmail account currently receives `nightingalenightmare@gmail.com`. Stage 3
  needs it.

> ⚠️ **This is not a DNS change and must not be made as one.** An alias is a setting on
> the mail package. Nothing goes in the zone, and the zone is at
> [Cloudflare](../../architecture/investigations/networking.md) now anyway — a record added
> at Fasthosts would save successfully and do nothing.

---

## Stop condition

**Do not merge the pull request that changes `race.contact` until stage 2 has passed.**

Publishing an address that bounces is worse than publishing a Gmail one. A runner who
writes about a transfer, a refund, or an injury and gets silence has no way to tell that
their mail went nowhere — and the club has no way to tell either, because a bounce goes to
them, not to us. Every `/nn` page prints this address, so getting it wrong is wrong
everywhere at once.

---

## Stage 1 — create the aliases

1. Fasthosts control panel → **Email** → the club domain → **Mailboxes and aliases**.
   (Fasthosts calls these **forwarders** in some views. Same thing: an address with no
   storage that hands mail on.)
2. **Add** an alias:
   - **Address:** `nightingalenightmare`
   - **Forwards to:** `info@southvillerunningclub.co.uk`
3. **Add** a second:
   - **Address:** `nn`
   - **Forwards to:** `info@southvillerunningclub.co.uk`
4. Save both.

**Do not create these as mailboxes.** A mailbox costs money, adds a password to hold, and
creates a second inbox that will go unread — which is the failure this arrangement exists
to avoid.

**Done when:** both appear in the alias list with `info@` as the destination.

---

## Stage 2 — prove mail arrives

Two sends, from **outside** the club's mail — a personal account on another provider, not
Gmail *Send mail as*, which can loop back without ever leaving the building.

1. Send to `nightingalenightmare@southvillerunningclub.co.uk`. Subject:
   `alias test 1`.
2. Send to `nn@southvillerunningclub.co.uk`. Subject: `alias test 2`.
3. Open `info@` and confirm **both** arrived.
4. **Check the spam folder too.** Arriving in spam is a fail, not a pass — it means the
   authentication path needs looking at before an entrant's question depends on it.
5. **Reply to one of them from `info@`**, through Gmail *Send mail as*. Confirm the reply
   leaves from the club address and not from a personal one. This is the half of
   [decision 003](../../decisions/decision-log.md) that the alias alone does not deliver.

**Done when:** both test messages are in `info@`'s inbox, and a reply left from the club
address.

**If a message does not arrive within ten minutes**, stop and do not merge. Check the alias
spelling first — a typo in the local part is the common cause and it fails silently, since
mail to an address that does not exist is simply rejected at the far end.

---

## Stage 3 — the old Gmail address

**Do this after the pull request has merged and the new address is live**, not before.
Until then the Gmail address is still the one on the website.

1. In the Gmail account, set up **forwarding to `info@southvillerunningclub.co.uk`** and
   confirm the verification mail that Gmail sends to it.
2. **Leave the account open.** It is printed on every flyer, race number and email thread
   from previous years, and closing it turns all of those into silent failures. Forwarding
   turns them into mail somebody reads.
3. Add an auto-reply if the committee wants one, saying the address has moved. Optional —
   the forward is what matters.

**Revisit closing it in a year**, once a race has run with the new address published and
the forward has gone quiet.

---

## Rolling back

Delete the alias. Mail to it is rejected from that moment, and `race.contact` would need
reverting in the same breath — the two are one change even though they live in two places.

There is no partial state worth keeping: an alias that exists but is not published costs
nothing, and a published address with no alias is the failure the stop condition exists to
prevent.

---

## Record of execution

Fill this in when it is run, per
[ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) — a
manual step is legitimate only when it leaves a trace.

| | |
| --- | --- |
| **Stage 1 — aliases created** | *Not yet run* |
| **Stage 2 — delivery verified** | *Not yet run* |
| **Stage 3 — Gmail forwarded** | *Not yet run* |
| **By whom** | |
