# ADR-024 — One entry in full, and the audit trail comes onto the surface

**Accepted**, 29 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-017](adr-017-permissions-are-what-code-checks.md), [ADR-018](adr-018-cancelling-an-entry.md), [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) |

## Context

`/admin/nn/` is a table of up to 250 rows, and a table can only carry what fits in a column. The
facts a volunteer actually needs when somebody rings up are, almost without exception, the ones
that did not fit:

- **which address paid**, which is the only way to find the entry from an email;
- when the payment settled, and whether it settled after the hold had lapsed;
- Stripe's checkout session and payment intent, which are what a refund is looked up by;
- the emergency contact, and the date of birth two people sharing a name are told apart by;
- what the club still owes them by email, and whether a message failed;
- **every ask that has been made about the entry**, rather than the last one;
- and what has already been done to it, by whom, and when.

Before this, the answer to most of those was three browser tabs — the Cloudflare log, the Stripe
dashboard and the Resend console — two more credentials, and a join done by eye. On a Sunday,
by a volunteer with a day job, while somebody waits on the phone.

Two of those facts were not merely inconvenient to reach. They were **not reachable at all**:

- **The full history of asks.** `entry_purchases.requested_action` holds one word, and a second
  ask overwrote the first. Somebody who pressed *Transfer*, thought better of it and pressed
  *Cancel* left a record saying only the second. The two want opposite things — one wants a
  refund and one deliberately does not — so a volunteer acting on the wrong one either takes a
  place off somebody who wanted to hand it to a friend, or hands on a place somebody wanted
  their money back for.
- **The audit trail.** `entries.admin_audit` has recorded every cancellation, transfer, export
  and medical read since the surface was built, and nothing anywhere could read it. The club
  could not answer *"who cancelled this, and when"* about its own records.

## Decision

**One page per entry, reached from its row, showing everything the club holds about it.**
`POST /admin/nn/entry/`, behind `nn.entry.read`, rendering the payment, the people, the asks,
the emails and the audit rows that name that entry.

### A purchase, not an entrant

The row on the list is a runner; the thing with a status, an amount, a payment and a history is
the **purchase** they are on. It is also the only shape that can render a cancelled entry at
all, because `cancel_entry()` deletes the runner — the same lesson #116 learned one page along
when the **Refunded** filter could never match a row.

### A POST, and no audit row of its own

A POST because **no personal data goes in a URL or a query string, ever** — the purchase id
travels in the body, exactly as the entrant id does for the medical note. It reads and changes
nothing, so it mints no CSRF token and needs none.

It writes **no** `admin_audit` row, and that is a line rather than an omission. It discloses
what the entry list and the three exports already disclose to the same permission, and
`read_entry_list()` is not audited either. Auditing every navigation would bury the four acts
that matter under thousands of look-ups — including, absurdly, inside the trail this very page
renders.

**The line is Article 9.** The medical note is audited and stays audited: it keeps its single
door, `entries.entrant_medical()`, which writes a row every time it opens. This page says only
*whether* a note exists and links to that door.

### The audit trail comes onto the surface, and that is a change of position

`CLAUDE.md` has said since the surface was built that *"the audit trail is deliberately not on
it"*, on two grounds. **The first expired with the two-key scheme**: rendering it would have
needed a fourteenth function granted to `anon`, and nothing on this surface is anon-callable any
more — `entries.admin_entry_detail()` is granted to `authenticated` and refuses anybody without
`nn.entry.read`, which is the same door the entry list is behind. **The second was that it is a
decision rather than a layout choice**, which is right, and this is the decision.

Two things bound it:

- **Scoped to one entry, never the whole trail.** It returns the rows that name *this* purchase,
  its entrants or its messages, so it is the history of a record rather than a log of what each
  volunteer has been doing. There is still no way to read `admin_audit` as a list, and adding
  one would be a separate decision.
- **The actor stays a pseudonym.** `auth.uid()`, which maps to a human only through
  `identity.people`. ADR-013's amendment settled that and this does not reopen it.

One gap follows from a promise worth keeping: a medical note read against an entrant who has
since been deleted cannot be matched back to the purchase, because the id it names no longer
joins to anything. `cancel_entry()` deleting the runner is the more important half of that
trade.

### What the page will not show

- **The medical note itself.** Whether, never what — see above.
- **`entry_purchases.consents`.** ADR-022 put the visually impaired declaration in the consents
  object rather than in a column *precisely* so that no read would return it: it is data about
  disability, held as the lawful basis for the guide's row, and never a fact on a screen. No
  read has ever returned that column and this one does not become the first. `consent_version`
  is returned, because which version of the terms was in force is a fact about the terms.
- **`person_id`.** Whether the entry is claimed by an account is worth knowing; whose account it
  is, as a uuid, is a fact nobody can act on. The page answers the boolean.

### Asks become a list

`entries.entry_requests` is the append-only record of every ask. The columns on
`entry_purchases` stay, holding the most recent one, because the **Asked about** filter and
every deployed reader use them — expand, migrate, contract.

**Resolution is a fact about the entry rather than about one ask.** There is no act that answers
one ask and leaves another open: a volunteer who cancels or transfers an entry has dealt with
everything outstanding on it. So every open row is closed at once, by a trigger watching
`entry_purchases.request_resolved_at` — which is what lets `cancel_entry()` and
`transfer_entry()` stay exactly as they are.

## Consequences

**A volunteer can answer the phone from one page.** That is the whole of the benefit and it is
worth stating plainly, because every fact on it was already in the database and none of it was
reachable.

**`/admin/nn/` now shows every outstanding ask on a row**, not the last one. A row with two asks
says so, and the page says they disagree.

**A fifteenth function is granted to `authenticated`.** `packages/db/tests/entries.test.ts`
asserts that list exactly, which is what forces the next one to be a decision somebody takes in
a diff. The `anon` list is unchanged at thirteen.

**The audit trail is now readable, in one shape, by anybody holding `nn.entry.read`.** That is
the cost of the decision above and it is deliberate: the alternative was a club that keeps a
record it cannot consult, which is a record that exists to be believed rather than read.

**Nothing about a runner's own view changed except that it stopped lying to them.**
`/account/entries/` showed one ask where somebody had made two, which reads exactly like the
second press having done nothing.
