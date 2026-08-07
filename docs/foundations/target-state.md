# Target state

What the club has when this is finished.

[Current state](current-state.md) is where things are. [Problem
statement](problem-statement.md) is why that isn't good enough. This is the destination —
[requirements](requirements.md) then say what has to be true to reach it, and
[options](../solutions/options.md) covers how.

Written as what changes for the people involved, because that is what makes it real. A
list of capabilities is a specification; this is the picture.

---

## For the people who use it

The site is where anyone — member or not — finds out everything about Southville Running
Club and acts on it.

**Pay for a club run.** Sessions run every Tuesday and Thursday. Anyone can pay for them
on the site, per run or as the monthly subscription, **members and non-members alike**.
This is the club's most common transaction and it should be the easiest thing on the site.

**Find out anything about SRC.** Who the club is, where and when it meets, what to expect
on your first night, which group to run in, the pace guide, terminology, kit, the
committee, policies and club documents. One place, current, and not requiring anyone to
ask.

**See what's on and buy a ticket.** Summer and Christmas parties, socials, and race
entries — visible on the site, bought on the site.

**Read the monthly club emails.** Every newsletter listed and readable, kept up to date
without anyone copying it across.

**Look up past race results.** Every running of every race, permanently, at an address
that does not change — this year's and any previous year's, without anyone typing them
out.

**Become a member, or get in touch.** Joining is a single clear path with an obvious
price, and there is always a plain way to reach a human.

**Find the club elsewhere.** Links out to Facebook, Instagram and the rest, because that
is where the photographs and the day-to-day conversation live.

The measure: **a runner who has never met the club can find it, understand it, pay for a
session and turn up on Tuesday, without a volunteer being involved.**

---

## For the people who run the club

**The Membership Officer** stops being the integration layer. Today a WhatsApp request is
a form checked by hand against membership records, joiners and leavers are processed
manually, and the real record lives in England Athletics' portal. In the target state the
platform knows who is current, and community access follows from that rather than from
somebody checking.

**The Treasurer** can reconcile. All four money flows — session payments, membership, race
entries, merchandise and tickets — land against real records, in a club account, with no
platform taking a cut on top of the card fee.

**The Race Director** runs a race and the results publish themselves. No re-keying, no
export-and-import, and a roster on race morning that was always the club's.

**The Quarter Master** stops maintaining a stock table by hand.

**The committee** can still change what they need to change, without a developer. That is
a requirement, not a hope — see the open question below.

---

## For the people who build it

**Either volunteer can cover for the other.** No system reachable by only one person.
Today four are.

**Every change is proposed, reviewed, tested and reversible.** A change is a commit
somebody else can see, not an edit somebody made in a browser session with no record.

**A third volunteer can pick it up** from the repository, with the decisions written down,
without a handover meeting.

---

## Structurally

- **One club domain**, with the website, Nightingale Nightmare and race timing under it.
- **One place for the club's operational data** — events, results, members, subscribers,
  entrants and orders — rather than the current split across a website platform, a timing
  database, a mailing tool and another organisation's portal.
- **Everything in the club's own version control**, defined as code, deployed by pipeline.
- **A permanent public results archive** that maintains itself.
- **Newsletters flow in from Mailchimp automatically** — the committee keeps writing where
  it already writes.
- **The club holds its own files.** Images, documents and minutes on infrastructure the
  club controls, not a platform's CDN that empties when a subscription lapses.

---

## Economically

| | Today | Target |
| --- | --- | --- |
| Website platform | £204/yr, middle tier required only to take payments | Domain and minimal hosting |
| Domain and DNS | £15.40/yr | £15.40/yr |
| Payment fees | Card processing **plus Squarespace's cut on every payment** | Card processing only |
| Volunteer hours | The manual chain in the [problem statement](problem-statement.md#3-volunteers-are-doing-work-the-system-should-do) | Substantially reduced |

The subscription saving is real but modest. **The volunteer time is the larger return**,
and it is the one that does not show up on an invoice.

---

## What this is not

- **Not a rewrite of the race timing system.** It works and it is proven. It joins the
  platform; it is not replaced by it.
- **Not a content management product.** Committee editing is a requirement; a CMS is only
  one way to meet it, and probably not the cheapest.
- **Not built for scale.** Around 100 teams, 150 solo entries, ~103 subscribers, ~175
  party tickets a year and roughly 900 site visitors a month. Anything sized larger is
  complexity the club pays for and does not use.
- **Not high availability.** The website being down for an hour is an inconvenience; the
  timing system already handles race night through its offline queue rather than through
  uptime engineering.
- **Not a mobile app.** A phone browser is the delivery mechanism.

---

## How we will know it worked

Honest position: **the club does not yet have baselines for most of these**, and it should
capture them before the work starts rather than reconstructing them afterwards.

| Measure | Baseline |
| --- | --- |
| Club-borne platform cost per year | **£734** — see [what the club pays](current-state.md#what-the-club-pays) |
| Squarespace's cut on payments | **£91/yr** at 2%, £137 at 3% |
| Total payment fees | **£516/yr on £4,560 collected — 11.3%** |
| Time spent processing a new member | **Not measured** |
| Time spent publishing race results | **Not measured** |
| Newsletters published on time | Currently drifting; July 2024 missing |
| Systems reachable by only one person | **Four** |
| Race entry data quality | Problems worked around at CSV import |
| Site usage — what people actually visit | **Captured**: ~1,114 visits and 926 unique visitors a month, **70% from a phone** — see [what it actually gets used for](current-state.md#what-it-actually-gets-used-for) |

The last one matters more than it looks: it decides what is worth rebuilding and what can
quietly be dropped.

---

## Open questions this raises

**What lives in code and what lives in a database?** The requirements say committee
members must still be able to change things without a developer, *and* that everything is
defined as code and changed by reviewed commit. Those pull against each other. Race dates,
results, newsletters and news clearly belong in data. Policies and page structure clearly
belong in code. The boundary in between — a kit price, a discount partner, a committee
member's name — is not yet drawn, and it is the central design question of the website.

**What are the actual entities?** The most valuable discovery in this work was that the
£2.50 payers **are not members**. Person, member, subscriber, entrant, customer and runner
are distinct and overlapping, and getting them wrong would build today's confusion into
the schema permanently. A domain model is needed before any table is created.

**How much of Squarespace's commerce state carries over?** Customer accounts, order
history and payment records exist today. Carrying them is work; abandoning them is a
decision that should be taken deliberately rather than discovered at cutover.
