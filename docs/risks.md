# Risk register

Carried forward from the [platform proposal](reference/platform-proposal-v8.md) and
extended with delivery risks specific to this repository.

Ordered by the club's exposure, worst first.

---

## R1 — Key-person dependency

**The platform is built and maintained by one volunteer.** This risk exists today and
grows with every workstream. It is the strongest argument for boring design and current
documentation, and it is why the principles read the way they do.

*Mitigations:*
- Everything in code, in the club's GitHub organisation, on mainstream services another
  developer could pick up ([P1](principles.md#p1--everything-is-code-nothing-is-clicked),
  [P6](principles.md#p6--boring-by-default)).
- A written runbook for the race director.
- Documentation updated in the same pull request as the change
  ([P12](principles.md#p12--documentation-is-part-of-done)).
- No credential or pipeline step that only one person can execute
  ([P4](principles.md#p4--deployment-is-a-pipeline-never-a-person)).

*Open:* at least one other person with production access, and one documented, rehearsed
handover.

---

## R2 — Member fund migration

All 94 recurring payers must actively re-subscribe. Roughly **£2,800 a year is exposed
during the switch**, and a ten percent shortfall (~£280) would outweigh the entire fee
saving.

*Mitigations — requirements, not niceties:* parallel running of old and new, a proper
comms push, chasing stragglers by name, and cancelling Squarespace **only** on the
treasurer's confirmation that income has fully moved.

---

## R3 — Data protection

Taking entries and memberships means holding names, dates of birth, EA numbers and
emergency contacts under the club's own responsibility. The EA check adds a
data-sharing dimension.

*Mitigations:* advice, a retention policy and a privacy notice **before the first record
is taken** ([P13](principles.md#p13--governance-gates-come-before-the-code-they-enable));
minimum-necessary collection, no personal data in logs or non-production environments
([P8](principles.md#p8--personal-data-is-a-liability-not-an-asset)).

---

## R4 — Hosting migration

If the Cloudflare route is chosen, the migration window is itself a risk. The thing that
would move is safety-critical: the timing app is proven, on Vercel, in front of a live
race.

*Mitigations:* migrate in the quiet season; run Vercel in parallel until Cloudflare is
proven; complete the full manual race-simulation checks before any event depends on it;
**never migrate near an event**
([P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not)).

*Note:* the split option (website and entries on Cloudflare, timing app untouched on
Vercel) avoids this risk entirely at the price of operating two platforms, and rests on a
reading of Vercel's terms worth confirming.

---

## R5 — Supabase free-tier pausing

The free tier pauses a project after roughly a week of inactivity and has no automated
backups. Quiet months between races are exactly when pausing would bite a permanent
archive.

*Mitigations:* public website traffic may keep the project active for free; ~£240/yr for
Supabase Pro is pre-approved contingency, spent only if needed. Monitoring must alert on
approaching inactivity rather than on the archive already being down.

---

## R6 — Payment operations

Refund requests, failed payments, the occasional dispute (a disputed payment costs about
£20 regardless of outcome). Small volume, but someone must own it.

*Mitigation:* the treasurer owns it, with tooling to reconcile Stripe payouts against
entries and memberships. A clear refund policy exists partly to keep disputes rare.

---

## R7 — WhatsApp gating limits

The one-time link is enforced by our token, not by WhatsApp. A determined leak is caught
by admin approval and link rotation, not prevented outright.

*Mitigation:* state the limit plainly wherever it is described, so nobody believes the
gate is stronger than it is. Set the group to admin approval; rotate the invite link.

---

## R8 — Website editability

Less convenient than Squarespace for ad-hoc edits by committee members.

*Mitigations:* database-driven content for anything that changes
([P2](principles.md#p2--the-database-is-the-source-of-truth-for-anything-that-changes));
minimal static content; a lightweight editing interface added later **only if** the
committee finds it genuinely needed.

---

## R9 — Nightingale Nightmare's date and the clocks change

The race sits at the clocks-change boundary — a genuine technical hazard for a timing
system.

*Mitigations:* settle the date question early; store all timestamps in UTC and render in
`Europe/London`; test explicitly against the real race date
([Testing strategy](testing-strategy.md)).

---

## R10 — Website launch and DNS cutover *(delivery risk)*

Repointing `southvillerunningclub.co.uk` from Squarespace is a visible, public change
with the potential to break every existing link and every search result.

*Mitigations:* redirects from every existing Squarespace URL, verified before cutover; a
low TTL set well in advance; a tested rollback to Squarespace; cutover outside a race
window; the Squarespace subscription kept live until the new site is proven.

---

## R11 — Scope creep into a CMS *(delivery risk)*

The editability trade-off creates constant pressure to build a general-purpose editing
system, which is where volunteer projects go to die.

*Mitigation:* [P14](principles.md#p14--prefer-deleting-to-adding). Database-driven
content first; measure what the committee actually needs to change; build the narrowest
thing that answers it, and only after launch.
