# Risk register

Carried forward from the [platform proposal](reference/platform-proposal-v8.md) and
extended with delivery risks specific to this repository.

Ordered by the club's exposure, worst first.

---

## R1 — Key-person dependency

**The platform is built and maintained by one volunteer.** This risk exists today and
grows with every workstream. It is the strongest argument for boring design and current
documentation, and it is why the principles read the way they do.

**Live instance, found 5 August 2026:** the timing app repository sits in a **personal
GitHub account** (`bindalshah/src-race-timing`), not the club's `admin-src` organisation.
The proposal names "code and documentation live in the club's reach on GitHub" as a
mitigation for this exact risk; for the club's race-day-critical software that is not
currently true. The same question applies to the Supabase project, the Vercel account and
— now — the Cloudflare and Fasthosts accounts.

*Mitigations:*
- **Transfer `src-race-timing` to `admin-src`.** One administrative action, before the
  port rather than after.
- Confirm ownership and second-administrator access on every account the platform depends
  on: Supabase, Vercel, Cloudflare, Fasthosts, Stripe, Resend.
- Everything in code, in the club's GitHub organisation, on mainstream services another
  developer could pick up ([P1](principles.md#p1--everything-is-code-nothing-is-clicked),
  [P6](principles.md#p6--boring-by-default)).
- A written runbook for the race director.
- Documentation updated in the same pull request as the change
  ([P12](principles.md#p12--documentation-is-part-of-done)).
- No credential or pipeline step that only one person can execute
  ([P4](principles.md#p4--deployment-is-a-pipeline-never-a-person)).

*Working in the club's favour:* the timing app's `DECISIONS.md` runs to 2,542 lines of
append-only, structured reasoning. It is the single strongest existing mitigation of this
risk, and the practice is worth copying rather than admiring.

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

## R4 — Timing app hosting migration

Cloudflare is now the decided target ([ADR-0002](adr/0002-hosting-platform.md)), so this
risk is accepted rather than avoidable. The thing that moves is safety-critical: the
timing app is proven, on Vercel, in front of a live race.

*Verified, reducing the risk:* `@opennextjs/cloudflare` supports all of Next.js 16 and
the app is on 16.2.4, so no framework downgrade is implied; edge middleware is supported
(the app's `proxy.ts` is edge, not Node, middleware); and the one Node built-in in use
(`randomInt` from `node:crypto`) is covered by `nodejs_compat`.

*Mitigations:* migrate in the quiet season, **after Nightingale Nightmare 2026**; run
Vercel in parallel until Cloudflare is proven; complete the full manual race-simulation
checks — including the true two-marshal end-to-end check the app's own log records as
still outstanding — before any event depends on it; **never migrate near an event**
([P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not)).

*Three things a port must not break:* the IndexedDB offline queue and its
idempotent-upsert contract; the TypeScript/SQL lockstep on bib resolution; and the
`Europe/London` pinning in `lib/london-time.ts`. See the
[timing app review](reference/timing-app-review.md).

---

## R4b — Workers platform limits

Cloudflare's free plan caps a Worker at **3 MB compressed** and **10 ms CPU per request**,
with 100,000 requests/day. Server-rendered Next.js is a poor fit for a 10 ms CPU budget,
and a Next app with a real dependency tree can approach 3 MB.

*Consequence:* the "£0 hosting" line in the proposal is optimistic for anything
server-rendered. Workers Paid (~£48/yr) should be **budgeted, not hoped against** — still
an order of magnitude below Vercel Pro's ~£190/yr, and the proposal already carries ~£48
as the paid-tier figure.

*Mitigations:* render statically wherever possible
([P11](principles.md#p11--built-for-a-phone-in-a-field-on-bad-signal)); treat every
dependency as a hosting cost
([P14](principles.md#p14--prefer-deleting-to-adding)); measure bundle size in CI and fail
the build on a budget breach; establish the real figures on the Nightingale Nightmare
service before committing the timing app.

---

## R4c — DNS delegation and club email

Moving nameservers to Cloudflare ([ADR-0005](adr/0005-dns.md)) moves **all** DNS, not just
the website. Club email is forwarding-only through Fasthosts livemail, which means `MX`,
`SPF`, four DKIM records and `_dmarc` are all load-bearing.

**The shape of the risk is the dual-answer window.** `.co.uk` publishes the delegation with
a 48-hour TTL, so for up to two days both nameserver sets are authoritative for different
people simultaneously. Identical records make this invisible; any discrepancy produces the
worst symptom in networking — some people fine, some broken, no pattern.

**The live hazard, specifically:** the MX points at `mail.southvillerunningclub.co.uk`, an
A record inside the zone. Proxy that record and inbound mail resolves to Cloudflare, which
does not speak SMTP. Cloudflare defaults new A records to proxied, so keeping it grey is an
active step. A second trap: Squarespace's verification CNAME (host
`9sw9cgfs3d8e53r2xcx5`) must also stay DNS-only, or Squarespace cannot verify the domain
and the live site breaks.

*Mitigations:* the pre-flight diff — Cloudflare's nameservers answer before delegation, so
both sides can be compared record-for-record until identical, proving the change is a no-op
before committing; copy exactly and change nothing else at the same time; keep the
Fasthosts zone intact as the rollback; TTLs lowered to 300 s 48 hours ahead; a deliberate
72-hour watch with real send-and-receive mail tests. Full procedure and options in
[ADR-0013](adr/0013-delegation-approach.md).

*Already in the club's favour:* **no CAA records**, so nothing blocks Cloudflare issuing
certificates; and **DMARC at `p=none`**, so authentication problems degrade toward spam
folders rather than outright rejection. Both remove whole categories of failure.

*Rollback is slow but rarely needed.* Reverting the delegation reconverges over the same 48
hours. But the 48 hours applies to the delegation, not the records — a missing record is
fixed in Cloudflare in seconds and live in minutes. **The fast path is forward.**

*Note the asymmetry:* this risk sits in the **early, invisible** step. The late, visible
apex cutover is a record change we control, reversible in seconds.

---

## R5 — Supabase free-tier pausing

The free tier pauses a project after roughly a week of inactivity and has no automated
backups. Quiet months between races are exactly when pausing would bite a permanent
archive.

**Two projects now carry this**, not one — the main project and Nightingale Nightmare's
([ADR-0012](adr/0012-one-supabase-project-many-services.md)). Nightingale Nightmare's is
the more likely to pause, since a race sign-up page goes quiet for eleven months of the
year.

*Mitigations:* public website traffic may keep the main project active for free; ~£240/yr
for Supabase Pro is pre-approved contingency, spent only if needed. Monitoring must alert
on approaching inactivity rather than on the archive already being down — a paused project
discovered by a member trying to sign up is a failure of monitoring, not of Supabase.

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
system. **The date is still unconfirmed** (25 October or 1 November) with roughly 11
weeks to go, which compresses every dependent decision.

*Working in the club's favour:* the timing app already treats this as a known foot-gun.
`lib/london-time.ts` exists solely to pin `Europe/London` on every conversion through one
tested path, because the rest of the app leans on ambient `toLocaleTimeString` and the
suite only passes because `TZ=UTC` is pinned. The module's own comment names the
one-hour-drift hazard.

*Mitigations:* settle the date **first** — it blocks the whole Nightingale Nightmare
track; store all timestamps in UTC and render in `Europe/London` through that one path;
run a race simulation against the real race date
([Testing strategy](testing-strategy.md)).

---

## R9b — Nightingale Nightmare timeline compression

Eleven to twelve weeks from 5 August 2026 to race day, with the date unconfirmed, a new
service to build, sign-up data whose scope is undecided, and three real gaps in solo
timing support.

*Mitigations:* time the 2026 race on Vercel rather than a freshly-ported Cloudflare
deployment; launch sign-ups minimal (expression of interest, name and email) and upgrade
later rather than commissioning data-protection advice against a race-day deadline;
develop on `*.workers.dev` so the build is not blocked by DNS delegation. See the
[plan of attack](plan-of-attack.md).

*The failure mode to avoid:* letting a fixed race date pull a hosting migration, a new
service and a data-protection process into the same eleven weeks.

---

## R10 — Website launch and apex cutover *(delivery risk)*

Repointing `southvillerunningclub.co.uk` from Squarespace is a visible, public change
with the potential to break every existing link and every search result.

*Reduced by [ADR-0005](adr/0005-dns.md):* because delegation
happens months earlier, by cutover time the club controls the records and their TTLs, and
rollback is a record change taking seconds rather than an NS change taking days.

*Mitigations:* redirects from every existing Squarespace URL, verified against a content
inventory before cutover; the rebuilt site proven on `beta.` first; cutover outside a race
window; the Squarespace subscription kept live until the new site has run a week.

*Sequencing correction:* the member fund must be re-homed **before the cutover**, not
merely before Squarespace is cancelled — the fund page lives on the Squarespace site and
the cutover would remove it.

---

## R10b — `beta.` competing with the live site in search *(delivery risk)*

A publicly-reachable rebuild on `beta.southvillerunningclub.co.uk` can be indexed,
splitting search authority and showing visitors an unfinished site.

*Mitigations:* `noindex` throughout the rebuild, verified in CI alongside the other
route checks; removed deliberately at cutover, not by memory.

---

## R11 — Scope creep into a CMS *(delivery risk)*

The editability trade-off creates constant pressure to build a general-purpose editing
system, which is where volunteer projects go to die.

*Mitigation:* [P14](principles.md#p14--prefer-deleting-to-adding). Database-driven
content first; measure what the committee actually needs to change; build the narrowest
thing that answers it, and only after launch.
