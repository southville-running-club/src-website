# Manual test pass — every button, as `nn-tester` and as `nn-admin`

**A checklist of every control a person holding one of these two roles can press**, with a
line to record what happened. It is the hand-run half of the definition of done: Playwright
covers a slice of this, `./dev test` cannot reach Stripe's own pages at all, and neither
proves anything about the production Worker on the day.

> ## Nothing here has been run yet
>
> **Every Result cell below is empty on purpose.** This document was written by reading the
> code, not by pressing anything — it is the list, not the evidence. Fill the cells in as
> you go and put the date, the browser and the environment in
> [the header block](#the-run-being-recorded) at the top of the run.

| | |
| --- | --- |
| **Scope** | Every control reachable by somebody holding `nn-tester`, and every control reachable by somebody holding `nn-admin`. Both roles, in one pass |
| **Not in scope** | `/admin/people/` — `nn-admin` does not carry `identity.person.read` and gets a 404, which is [X1](#part-c--what-must-not-be-reachable) rather than a page to test. The evergreen `/nn/` pages, the club site and the timing app carry no control either role owns |
| **Effort** | **About ninety minutes** for Part A and Part B together, plus whatever the refusals in [section D](#d--the-refusals) cost to set up |
| **Prerequisites** | Two accounts, the roles granted, and — for T16 onward — Stripe keys bound. See [Part 0](#part-0--before-you-start) |
| **Where the reasoning is** | [The admin runbook](entries-admin.md) for the surface, [ADR-013](../../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) for who may read it, [ADR-028](../../architecture/decisions/adr-028-a-place-can-be-given.md) for the given place, [ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md) for the entry key |

---

## The run being recorded

Fill this in before you start, and again for each environment you repeat it on.

| | |
| --- | --- |
| **Date** | |
| **Environment** | local `./dev up` / production |
| **Browser and version** | |
| **Viewport** | Both **320px** and **≥1280px** are needed — see [the note below](#two-widths-not-one) |
| **Stripe mode** | test / live |
| **Run by** | |

**Result cells take one of four words**, and nothing else: **Pass**, **Fail**, **Blocked**
(a precondition was not met) or **Skipped** (deliberately not run — say why in the notes).
A blank cell means nobody looked, which is not the same as a pass.

### Two widths, not one

**Six columns on `/admin/nn/` are `admin-col-wide` and fold away below 768px**, including
the one holding *Details*, *Cancel* and *Transfer*. A second copy of *Details* rides in the
stack under the runner's name for exactly that reason. So **B15** and **B16** are two rows
in this table rather than one: at 1280px the cell's button is the live one and the stacked
copy is `display: none`, and at 320px it is the other way round. Testing one width tests
half of it.

The same rule applies to the entry form: **T13**'s button and the confirm notice's **T12**
are different controls that submit the same form, and the second one exists because the
first is at the foot of seven fieldsets.

---

## Part 0 — before you start

Neither role can grant itself anything, so somebody holding `super-admin` does steps 0.1 and
0.2 first. That is [the admin runbook](entries-admin.md)'s job, not this one's.

| # | Precondition | How | Done |
| --- | --- | --- | --- |
| **0.1** | A test account holding **`nn-tester`** | `/admin/people/`, as a `super-admin` | |
| **0.2** | A test account holding **`nn-admin`** | Same page. **Not the same account** — a person holding both cannot tell you what either sees alone | |
| **0.3** | At least one **paid** entry on `nn-2026` | Either a tester payment from T17, or a place given at B32 | |
| **0.4** | At least one **refunded** and one **expired** purchase | Needed by B4's chips and by B8. A lapsed hold arrives on its own after 31 minutes | |
| **0.5** | At least one entry carrying a **medical note** | Needed by B17, B12 and B13 | |
| **0.5a** | ⚠️ At least one entry carrying a **guide** | **Needed by B10 and B11, and it is the precondition this pass was written without.** A guide is asked no race category, and a start-list export with one in it is the case that broke both start-list buttons for every runner on the sheet. A field of runners only will pass B10 and B11 while proving nothing | |
| **0.6** | At least one **failed** outbox message | Needed by B40. A `failed` row is the only status that renders a button | |
| **0.7** | `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` bound | Everything from T16 needs them. Without them the Worker answers **503** and the pass stops at T15 | |
| **0.8** | `ENTRIES_ENTRY_KEY` installed and verified | Since [ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md) no place can be held without it — the whole of Part A's section C fails identically if it is missing | |

⚠️ **Do not run this against production with live keys unless you mean to.** T17 takes a
real £1 and B25 refunds a real payment, and
[the key-swap runbook](entries-stripe-keys.md) is the reason the two must not be split
across a mode change: a payment intent of one mode cannot be refunded by a key of the other,
and the place is then consumed for ever.

⚠️ **`.dev.vars` is a volunteer's file, not an agent's.** If a local `./dev test` reports
`expected 303 to be 503`, that is a machine with a Stripe key on it rather than a
regression — and moving the file aside is a step one of the two people who own the key does.

---

## Part A — everything `nn-tester` can press

`nn-tester` carries **one permission**, `nn.entry.before_open`, and it opens exactly one
thing: the entry form on `/nn/2026/` before the window opens, with the £1 **Tester** fee on
it. It is **not staff** — `isStaff()` is a role list precisely so that a permission-holder
does not walk into `/admin/`, which is X2.

### A — getting in

| # | Where | Control | Expected | Result |
| --- | --- | --- | --- | --- |
| **T1** | `/account/sign-in/` | **Sign in** | Signs in; lands on `/account/`. Three cookies are set, `src_ax` among them | |
| **T2** | `/account/sign-in/` | **Email me a link** | A magic link arrives. **Account mail carries no `Reply-To`** — that is #99 and not a failure here | |
| **T3** | `/account/sign-in/` | **Sign in with Google** | **Rendered only when `GOOGLE_SIGN_IN` is set.** If the button is absent, record *Skipped* — do not record a failure | |
| **T4** | `/account/` | **Sign out** | Signed out everywhere. **Run this last**, after T30 | |

### B — the year page, as a tester

Everything here is on `/nn/2026/`. The window is `pre_open` in production, so a signed-out
visitor sees the interest form and the tester sees the entry form: that difference is the
first thing to check.

| # | Control | Expected | Result |
| --- | --- | --- | --- |
| **T5** | The page itself | The **entry form**, plus the early-entry notice saying why it is visible. A signed-out window on the same URL shows the **interest form** | |
| **T6** | **Race category** radios — Men's, Women's, Non-binary | All three selectable. **Non-binary reveals the placement question** below it | |
| **T7** | **Placement** radios — Men's, Women's, Neither | Only offered after Non-binary. Choosing *Neither* is a real answer, and the band resolves to `not-placed` rather than to an error | |
| **T8** | **Entry type** radios — Affiliated £18, Unaffiliated £20, Tester £1 | Three, and **only** three. `vi_guide` and `complimentary` must not appear. The running total updates and reads `£18.00`, never `££18.00` or `£Free` | |
| **T9** | **Visually impaired / guide** checkbox | Reveals the guide's six fields **below** it. The fields sit after the checkbox, never around it — a collapse here must move nothing above | |
| **T10** | **Medical consent** checkbox | The notes box follows the consent, not the other way round | |
| **T11** | **Entry terms** checkbox | Leaving it unticked and submitting is refused, and the refusal names the terms | |
| **T12** | **Continue to payment**, in the confirm-total notice | Only after a code was typed. **Nothing is charged and no place is held at this point** — the notice says so, and it must be true | |
| **T13** | **Continue to payment**, at the foot of the form | Submits. With a code typed and unconfirmed, it returns the confirm step rather than going to Stripe | |
| **T14** | The two email boxes, **signed in** | **`disabled`, not merely hidden.** This is the defect that took the form down for every signed-in runner on 31 August 2026: a hidden `required` box is still validated, and the browser silently refuses to submit. Signed out they must **not** be disabled | |
| **T15** | The error summary | Submit an empty form. Every problem is listed, and **each entry links to the field it is about** — with scripting off as well as on | |

### C — what the button actually does

| # | Where | Expected | Result |
| --- | --- | --- | --- |
| **T16** | The submit | **303 to Stripe Checkout**, for exactly £1 on the Tester fee. A `pending` purchase exists with a 31-minute hold | |
| **T17** | Stripe's own **Pay** button | Returns to `/nn/2026/entry/complete/`. The purchase reaches `paid` **via the webhook**, never via the redirect | |
| **T18** | Completion page — **Check again** | A plain link to the same address. While the webhook is in flight the page claims nothing, in either direction | |
| **T19** | Completion page — **Back to Nightingale Nightmare 2026**, and the `mailto:` links | All resolve. The club's address is 47 characters and is the thing that overflows a 320px page when `base.css` has not applied — check at 320px | |

### D — the refusals

Each of these has its own outcome block on the page, and each says something different.
**A block that says the wrong thing is a defect even when the refusal is correct** — half of
these exist to stop somebody paying twice.

| # | Make it happen by | Expected | Result |
| --- | --- | --- | --- |
| **T20** | Filling the event to 250 | `sold_out`. Nothing held, nothing charged | |
| **T21** | Submitting after `entries_close_at` | The closed block. It may not claim anything was stored | |
| **T22** | Entering twice under the same name and date of birth | `already_entered` | |
| **T23** | Entering twice under the same email address | `email_already_entered`. **A separate rule from T22, and neither subsumes the other** | |
| **T24** | Typing a code that does not exist, or one scoped to another fee | `invalid_discount`, reported on the code field | |
| **T25** | A 100% code | `free_place` — **refused before anything is held.** Stripe will not take a zero total, and a free place is *given* from `/admin/nn/` instead | |

### E — the runner's own record

| # | Where | Control | Expected | Result |
| --- | --- | --- | --- | --- |
| **T26** | `/account/entries/` | **Ask to cancel this entry** | Records an ask. **It cancels nothing** — a volunteer acts, and no email goes out on the ask | |
| **T27** | `/account/entries/` | **Ask about transferring it** | Same form, same reason box; `name="action"` carries which was pressed. Typing in the box and pressing the *other* button must not lose what was typed | |
| **T28** | `/account/entries/` | **`?show=cancelled`** and the way back | An empty Cancelled view says **"Nothing here"** and never *"you have never cancelled an entry"*. A lapsed hold is filed here, with its own status sentence | |
| **T29** | `/account/data/` | **Download my data** | A file, to the device. The club does not email it | |
| **T30** | `/account/data/` | **Delete my account** | Needs `DELETE` typed. ⚠️ **Irreversible, and it leaves a paid entry alone** — use a throwaway account and run it last | |

### F — the other half of the same page

| # | Where | Control | Expected | Result |
| --- | --- | --- | --- | --- |
| **T31** | `/nn/2026/`, **signed out** | **Register interest** | The interest form, not the entry form. It takes no money and asks the database nothing about who is asking | |

---

## Part B — everything `nn-admin` can press

`nn-admin` carries seven permissions: `nn.entry.read`, `nn.entry.read_medical`,
`nn.entry.export`, `nn.entry.cancel`, `nn.entry.create`, `nn.email.read` and
`nn.email.resend`. It does **not** carry `identity.person.read`, which is X1.

### The frame

| # | Where | Control | Expected | Result |
| --- | --- | --- | --- | --- |
| **B1** | Masthead, every page | **Dashboard**, **Nightingale Nightmare**, **Emails**, the club mark, **My account** | Four doors and no fifth. **People and roles must be absent** | |
| **B2** | `/admin/` | The two section links | Nightingale Nightmare and Emails. No People paragraph at all | |

### `/admin/nn/` — the entries

| # | Control | Expected | Result |
| --- | --- | --- | --- |
| **B3** | **Assign a place** | Opens the give-a-place form. Rendered only because this role holds `nn.entry.create` | |
| **B4** | **Status** chips — All, Paid, Pending, Expired, Refunded, Needs a human, Asked about | Seven. Each is a URL somebody can send. **Pressing Refunded must return rows** — an empty Refunded view is the #116 defect returning | |
| **B5** | **Entry type** chips | All, plus one per fee present. Rendered only when there are two or more fees | |
| **B6** | **Sort by** chips — Name, Entered, Category, Status | Four, and each re-sorts without dropping the other filters | |
| **B7** | Hide toggle — **test entries** | *Hide them* / *Show them*. Moves as a unit and carries the other group forward untouched | |
| **B8** | Hide toggle — **refunded and lapsed** | Same. An explicit `?status=` overrules the *default* and never overrules a `hide=` somebody chose | |
| **B9** | **Open the interest list** | `/admin/nn/interest/` | |
| **B10** | **Print the start list** | A printable page. **A POST, because rendering it writes a `start_list_export` audit row**. ⚠️ **Run it against a field containing a guide** — see 0.5a. Their row must read *Guide* in the Category column and carry no phone number of their own | |
| **B11** | **Download as CSV** (start list) | `text/csv`, `content-disposition: attachment`, a filename. Audited the same way, and it must agree with B10 row for row. **Assert the response, not a download event** — WebKit on Linux renders it in the tab | |
| **B12** | **Print the medical sheet** | Special category data. Writes `medical_export` | |
| **B13** | **Download the notes as CSV** | Same read, same audit row. **Deliberately named differently from B11** — two identical accessible names on one page are two rows a screen reader cannot tell apart | |
| **B14** | **Download the affiliated list** | No England Athletics column — the club holds none. A guide is **excluded** | |
| **B15** | Row — **Details**, in the actions cell | **≥768px only.** Opens `/admin/nn/entry/`. Offered on **every** row, a cancelled one included | |
| **B16** | Row — **Details**, in the stack under the name | **≤767px only.** The same page. Exactly one of B15 and B16 is in the accessibility tree at any width | |
| **B17** | Row — **Show note** | Only where there is one. Every opening writes an audit row | |
| **B18** | Row — **Cancel** | Opens the confirmation. **This POST changes nothing** and mints the token the second one echoes | |
| **B19** | Row — **Transfer** | Opens the transfer form. Beside Cancel and only where Cancel is | |

### `/admin/nn/entry/` — one entry in full

| # | Control | Expected | Result |
| --- | --- | --- | --- |
| **B20** | **Show note**, per entrant | *Whether*, never *what*. The note's text may not appear on this page | |
| **B21** | **Cancel this entry** | The same confirmation as B18 | |
| **B22** | **Transfer this entry** | The same form as B19 | |
| **B23** | **The whole queue** | `/admin/emails/` | |
| **B24** | **Back to the entries** | Returns to the running this purchase belongs to | |

### Cancelling

| # | Where | Control | Expected | Result |
| --- | --- | --- | --- | --- |
| **B25** | Confirm page, a **card** payment | **Cancel this entry and refund it** | Refunds **in full** — a partial refund does not exist in this codebase. Entrants deleted, place returned, and the row stays on `/admin/nn/` reading *No runner recorded* | |
| **B26** | Confirm page, a **£0 given** place | **Cancel this entry** | Different words, because there is no payment intent and nothing to refund. The email for it says so too | |
| **B27** | Confirm page | **Leave it alone and go back** | Nothing happens to the entry | |
| **B28** | Outcome page | **Back to the entries** | Returns to the list | |

### Transferring

| # | Control | Expected | Result |
| --- | --- | --- | --- |
| **B29** | **Move the place to this runner** | The runner changes and **nothing else does**: same purchase, same amount, same place. No money moves, no account is created, and the previous runner's medical note and gender identity are deleted | |
| **B30** | The same, refused | Re-applies the minimum age, one-runner-one-place **and** one-place-per-email. An affiliated place must transfer like any other — a `check_violation` surfacing as *"the club's database could not be reached"* is the old defect returning | |
| **B31** | **Leave it alone and go back to the entries** | Nothing moves | |

### Giving a place

| # | Control | Expected | Result |
| --- | --- | --- | --- |
| **B32** | **Give this place** | A `paid` purchase at £0 on the £0 fee, audited, counted against the 250. **Nothing is emailed by the give itself** — the confirmation comes from the insert trigger, so check one arrives and that it quotes £0 rather than *"we have received your payment of £0.00"* | |
| **B33** | **This runner is visually impaired and a guide runs with them** | The guide is a second row with `role = 'guide'`, takes a **second** one of the 250, pays nothing, is marked on the start list and is excluded from the affiliated export | |
| **B34** | **I have this runner's agreement to the entry terms**, unticked | Refused, and the refusal says which box | |
| **B35** | **Go back to the entries without giving one** | Nothing is created | |

### The other pages

| # | Where | Control | Expected | Result |
| --- | --- | --- | --- | --- |
| **B36** | `/admin/nn/interest/` | **Back to race admin** | Returns to `/admin/nn/` | |
| **B37** | The medical note page | **Back to the entries** | Returns to that running | |
| **B38** | The printed start list | The **browser's own** print command | **There is no print button and its absence is the decision** — there is no JavaScript on this surface. `@media print` drops the masthead | |
| **B39** | The printed medical sheet | Same | Same | |

### `/admin/emails/`

| # | Control | Expected | Result |
| --- | --- | --- | --- |
| **B40** | **Send again**, on a **failed** message | Re-queues it. Rendered only because this role holds `nn.email.resend` | |
| **B41** | A **sent** or **pending** row | **No button at all.** The club cannot un-send an email, and a pending one is already owed | |

---

## Part C — what must *not* be reachable

A pass here is a control that is absent or an address that 404s. **A 403 is a failure**, not
a near miss: it discloses that the address exists.

| # | Try | Expected | Result |
| --- | --- | --- | --- |
| **X1** | `/admin/people/` as **`nn-admin`** | The ordinary **404** page, and no *People and roles* entry in the navigation | |
| **X2** | `/admin/`, `/admin/nn/`, `/admin/emails/` as **`nn-tester`** | **404 at every one.** A permission-holder is not staff | |
| **X3** | `/nn/2026/` as a **plain member** and **signed out** | No Tester fee, no early notice, and the interest form | |
| **X4** | Posting `feeCode=tester` straight at PostgREST with the published anon key | `invalid_fee`. Hiding a price and refusing it are separate jobs and both must hold | |
| **X5** | A stale or absent CSRF token on the second step of Cancel, Transfer, Assign or Send again | Refused | |
| **X6** | `/admin/nn/entry/` | The medical note's **text** appears nowhere; `consents_version` appears and `consents` does not | |
| **X7** | The three exports and the printed start list | **`gender_identity` appears in none of them.** It is on `/admin/nn/` and nowhere else | |
| **X8** | Any of the exports | The CSV carries the byte-order mark `EF BB BF` on the wire — `Response.text()` strips it silently, so check the bytes | |

---

## What this pass deliberately does not cover

* **`/admin/people/` itself.** It needs `super-admin` or `people-admin`, which is a third
  role and a different pass — [the admin runbook](entries-admin.md) owns it.
* **The account forms beyond the tester's path.** Sign-up, password change, reset and the
  details page are `account.spec.ts`'s, and they belong to no role.
* **Clearing an `attention` flag.** There is no button — it is
  [a runbook](entries-attention.md) and a hand-written `update`.
* **`entries_open_at`.** Nothing in this pass sets it, and nothing in this pass should.
  Opening the window is [the entries-open runbook](entries-open.md)'s single `update`, and
  the whole point of `nn-tester` is that the payment path can be proved without it.
