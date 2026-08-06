# DNS and the domain

Whether to move away from Fasthosts, what it buys, and what it actually risks.

The club's position is that **moving is not ideal** — the domain works, club email works,
and downtime is the thing to avoid. That position is right, and this document does not
argue with it. It argues with the assumption underneath it: that "moving off Fasthosts" is
one decision.

**It is four**, they are independent, and three of the four carry almost no risk.

Baseline facts — the 18 records, the mail arrangement — are in [current
state](../foundations/current-state.md#dns-and-email). The hosting candidates that make this question
live are in [platform options](platform-options.md).

---

## Four separable things

| | What it is | Where it is today | Cost |
| --- | --- | --- | --- |
| **1. Registration** | Who the club's domain is registered through | **Fasthosts** *(assumed — unverified)* | Part of the £15.40 |
| **2. Authoritative DNS** | Who answers queries for the zone | Fasthosts | Part of the £15.40 |
| **3. Mail routing** | The MX target, SPF, DKIM, DMARC | Fasthosts livemail, **forwarding to Gmail** | Included |
| **4. Individual records** | Where `www` and the apex point | Squarespace | — |

Any of these can move without the others. In particular:

- **Authoritative DNS can move while registration stays at Fasthosts.** This is the common
  case and it is what "moving to Cloudflare DNS" means in practice — it is a nameserver
  change at the registrar, not a transfer.
- **Registration can move while DNS stays put**, and it changes nothing technical at all.
- **Records can be added and changed** without either.

Conflating these is what makes the whole thing feel dangerous. Separated, only one of the
four touches club email.

---

## Before anything else: who actually holds the registration?

[Current state](../foundations/current-state.md#dns-and-email) records this as **not established**.

**This is the single highest-consequence unknown in the whole programme**, because the
plan is to cancel Squarespace in April. If Squarespace holds the registration — some
Squarespace plans include a domain — then cancelling the subscription puts the club's
domain at risk, and the first anyone would know is when the site and every club email
address stopped working.

The evidence points to Fasthosts: the club pays Fasthosts £15.40 a year for "domain and
DNS", Fasthosts is authoritative for the zone, and the only Squarespace record in the zone
is a `verify.squarespace.com` CNAME, which proves domain *verification*, not ownership.

**That is inference, not verification.** It takes one lookup:

```bash
whois southvillerunningclub.co.uk | grep -iA2 registrar
```

Nothing else in this document should be actioned until that returns an answer, and the
answer should be written into the [decision log](../decisions/decision-log.md). It costs five minutes
and it removes a risk that could not be recovered from quickly.

---

## The four moves, by risk

Ordered by how much damage each can do. This ordering is the useful part of the document.

### Move 1 — Add a record. **No risk.**

Adding `nn.southvillerunningclub.co.uk` as a CNAME at Fasthosts is **purely additive**. It
creates a name that does not exist today and modifies nothing that does.

| | |
| --- | --- |
| Can it break club email? | **No.** It touches no MX, SPF, DKIM or DMARC record |
| Can it break the current site? | **No.** It touches neither the apex nor `www` |
| How is it reversed? | Delete the record. Effective within the TTL |
| Downtime | **None** |

**This is how Nightingale Nightmare goes live**, and it is why the two-week deadline never
required a DNS migration. See [Nightingale Nightmare first](../delivery/nn-first-delivery.md).

### Move 2 — Repoint the website. **Low risk, fast to reverse.**

Changing the four apex `A` records and the `www` CNAME to point at the new site, when it
is ready and proven.

| | |
| --- | --- |
| Can it break club email? | **No** — but see the SPF note below |
| What is affected | The website only |
| How is it reversed | Change the records back. Effective within the TTL |
| Downtime | **None**, if TTLs are lowered 48 hours beforehand. Otherwise bounded by the current TTL |

**The SPF footnote, because it is easy to miss.** The club's SPF record is `v=spf1 mx a
include:_spf.livemail.co.uk ~all`. The `a` mechanism authorises *whatever the apex A
records currently point at* to send mail as the club. Repointing the apex silently changes
which addresses SPF authorises. It will not break anything — `include:_spf.livemail.co.uk`
is what actually authorises outbound mail — but `a` should be dropped when the apex moves,
because it will then be authorising a hosting provider's shared infrastructure for no
reason.

### Move 3 — Move authoritative DNS. **The only genuinely risky move.**

Pointing the nameservers at a new provider. Everything moves at once, including mail
routing.

| | |
| --- | --- |
| Can it break club email? | **Yes** — this is the one that can |
| What is affected | Every record in the zone, simultaneously |
| How is it reversed | Change the nameservers back at the registrar. **Propagation can take up to 48 hours** |
| Downtime | **None if every record is copied exactly.** Total for anything that was not |

This is the move [options](options.md#c5c1--dns) already identified as the
counter-intuitive one: *"moving nameservers is invisible if records are copied exactly,
and slow to reverse."*

**The switch itself does not cause downtime.** During propagation both providers answer,
and if they answer identically nobody notices anything. **A wrong record causes downtime**
— and it causes it for as long as it takes to notice plus the time to fix it.

So the work is entirely in the diff, not in the switch.

#### What specifically can go wrong

Four hazards, in order of how likely they are to be missed:

**1. Proxying a mail record.** Cloudflare proxies `A` records by default. A proxied record
returns Cloudflare's addresses and only carries HTTP and HTTPS. The zone has **four**
records that must stay DNS-only:

| Record | Why |
| --- | --- |
| `mail` → 213.171.216.40 | **The MX target.** Proxying it stops all inbound mail |
| `mailserver` → 213.171.216.40 | Fasthosts livemail |
| `smtp` → 213.171.216.50 | Outbound |
| `webmail` → 213.171.216.231 | Webmail access |

This is the single most common way this migration is botched, and its symptom is silent —
inbound mail defers, then bounces, and nobody is told.

**2. The MX target lives inside the zone.** `MX @ → mail.southvillerunningclub.co.uk`.
That is not an external hostname; it resolves through the zone's own `mail` A record. So
the `mail` record is load-bearing for *all* inbound club mail, and if the migration drops
it — a scan missing one record, a typo in an address — mail stops with no obvious cause.

**3. The four DKIM CNAMEs.** `livemail1._domainkey` through `livemail4._domainkey`, all
pointing into `dkim.livemail.co.uk`. Automated zone scans usually find these, but
"usually" is not a migration plan. Losing them does not stop mail; it makes it fail
authentication, and with **DMARC at `p=none`** the failure degrades quietly into spam
folders rather than announcing itself. That is worse, not better — it is a failure the
club would discover from a member saying they never got a reply.

**4. The `mcp` record.** `mcp → 213.171.195.10`, purpose unknown, already flagged in
[priorities](../delivery/priorities.md#actions-that-block-nothing-and-cost-nothing). Copy it, keep it
DNS-only, and find out what it serves before taking responsibility for the zone.

#### One more thing that is not a hazard but is a trap

**Cloudflare's free plan does not offer partial (CNAME) zone setup** — that is a
Business-plan feature. On the free plan it is full nameserver delegation or nothing. So
there is no halfway house where Cloudflare serves the apex while Fasthosts keeps the zone.

That is exactly why [platform
options](platform-options.md#the-one-question-that-decides-between-c-and-d) frames Netlify
as the alternative: it serves an apex from third-party DNS, so Move 3 never has to happen
at all.

### Move 4 — Transfer the registration. **Administrative risk only.**

| | |
| --- | --- |
| Can it break club email? | **No** — a transfer does not change DNS if the nameservers are unchanged |
| How `.co.uk` works | An **IPS tag change**, not an auth code. No transfer fee, and **no extra year is added** |
| How is it reversed | Ask the new registrar to set the IPS tag back |
| Downtime | **None** |
| What it saves | £15.40/yr → an at-cost registrar fee, expected **under £10/yr** *(verify)* |

Two constraints worth knowing before anyone gets keen: **Cloudflare Registrar requires the
zone to already be on Cloudflare**, so this can only follow Move 3; and a transferred
domain is **locked for 60 days** afterwards.

**Saving £7 a year is not a reason to do this.** The reasons that would justify it are
consolidation — one fewer account, one fewer login, one fewer thing only one person can
reach — and those are real. They are also not urgent.

---

## Should the club move DNS at all?

Honestly stated: **it depends on a hosting decision that has not been made**, and it
should not be made the other way round.

### The case for moving

| | |
| --- | --- |
| **It is required for Cloudflare at the apex** | The cheapest hosting option needs it. Netlify does not |
| **DNS becomes code** | Cloudflare's zone can be managed with Terraform or OpenTofu, so a record change becomes a reviewed commit. Fasthosts offers no such thing. This is the club's [foundational requirement](../foundations/requirements.md#everything-is-defined-as-code) applied to the one system where it currently cannot be |
| **It removes a single point of failure** | A club-owned Cloudflare account with both volunteers as admins replaces a Fasthosts account [one person can reach](../foundations/current-state.md#accounts-and-access) |
| **It costs nothing** | Cloudflare's DNS is free, and it is faster than most registrar DNS |
| **It defuses a live hazard** | Two records carry a Fasthosts *"manually changed — restore automatic updates"* prompt. Anyone clicking that repoints the apex at 88.208.252.9, Fasthosts' own hosting. That button is sitting in the control panel today |

### The case against

| | |
| --- | --- |
| **It is the only move that can break club email** | Everything else in this programme is reversible in minutes. This one is reversible in up to 48 hours |
| **It buys nothing the club needs this month** | Nightingale Nightmare does not need it. The website rebuild does not need it until the apex moves |
| **Netlify makes it unnecessary** | About £85/yr removes the entire question — see [platform options](platform-options.md#option-d--netlify--supabase) |
| **Fasthosts livemail is doing a job** | Forwarding to Gmail works. Leaving Fasthosts entirely eventually means replacing it |

### The position this document takes

**Move DNS, but deliberately, and nowhere near a deadline.**

The decisive argument is not the £15.40 and not Cloudflare's pricing. It is that **DNS is
the club's last remaining click-operated system reachable by one person**, sitting behind
a control panel with a button that would repoint the apex. Every other part of this
programme is being rebuilt to be code, reviewed and shared. Leaving DNS as the exception,
in the account it is currently in, would leave the club's most fragile dependency exactly
as it is.

**But it is not urgent, and it must not be bundled with anything else.** Specifically:

- **Not before Nightingale Nightmare.** NN needs Move 1, which is free of risk.
- **Not on the same day as the apex cutover.** Two changes at once means an outage with
  two candidate causes.
- **Not in the same month as a race.**
- **Not combined with a registrar transfer or a mail-provider change.**

If the club decides it does not want to move DNS at all, **that is a supportable
position** — choose Netlify, accept about £85/yr, and this document's Move 3 never
happens. What is *not* supportable is choosing Cloudflare for hosting and then discovering
the nameserver requirement afterwards.

---

## The runbook, if Move 3 goes ahead

Written out because "we'll be careful" is not a plan, and because a second volunteer
should be able to check the work.

### Before — capture and stage

1. **Export the current zone.** Ask Fasthosts for a zone file, or capture every record by
   hand from the control panel. Commit it to this repository. It is the rollback reference
   and the diff baseline.
2. **Confirm the record count.** [Current state](../foundations/current-state.md#dns-and-email) says
   **18**. If the export shows a different number, find out why before continuing.
3. **Lower TTLs to 300 seconds at Fasthosts**, and wait at least 48 hours. This shrinks
   the blast radius of anything wrong from hours to minutes.
4. **Create the zone at the new provider and let it scan**, then **add every missing
   record by hand.** Assume the scan missed something; it usually misses at least one
   CNAME.
5. **Set every mail record to DNS-only.** `mail`, `mailserver`, `smtp`, `webmail`, `mcp`,
   and all four DKIM CNAMEs. Nothing but the apex, `www` and the site's own hostnames may
   be proxied.
6. **Diff, record by record, against the export.** Not by eye — query the new nameservers
   directly and compare:

   ```bash
   for r in @ mail mailserver smtp webmail mcp www _dmarc; do
     dig +short @NEW-NAMESERVER "$r.southvillerunningclub.co.uk" ANY
   done
   ```

7. **Have a second person check the diff.** This is exactly the kind of change the club's
   [review requirement](../foundations/requirements.md#everything-is-defined-as-code) exists for.

### During

8. **Pick a quiet weekday morning.** Not a Friday, not a race week, not the week
   Squarespace renews. Someone must be available for the rest of the day.
9. **Change the nameservers at the registrar.** One action.
10. **Send a test message to a club address immediately**, and confirm it arrives at the
    Gmail account it forwards to. This is the check that matters — everything else can
    wait.
11. **Confirm the website still resolves and serves**, from a device on mobile data as
    well as the club's own network.

### After

12. **Watch for 48 hours.** Send and receive on club addresses daily.
13. **Check DMARC reports.** `p=none` means reports arrive and nothing is rejected — use
    them rather than waiting for a complaint.
14. **Raise TTLs back** to something sensible once stable.
15. **Commit the zone as code** — Terraform or OpenTofu, so the next change is a pull
    request.
16. **Leave the Fasthosts zone intact** for at least a month. It is the rollback.

### Rollback

Point the nameservers back at Fasthosts. **Effective in up to 48 hours**, which is why
steps 1–7 matter far more than steps 8–11. For anything urgent inside that window, the
record can also be corrected at the *new* provider, which takes effect within the TTL — so
in practice the fast fix is to repair forward, and reverting the nameservers is the last
resort.

---

## Club email, deliberately left alone

Worth stating explicitly, because it is the thing most likely to be broken by accident and
the least likely to be noticed.

**Today:** forwarding-only through Fasthosts livemail, to Gmail accounts. There are
addresses on the domain but no mailboxes the club hosts.

**Two things could eventually replace it:**

| | |
| --- | --- |
| **Cloudflare Email Routing** | Free, forwarding-only — exactly the shape the club already uses. Requires the zone on Cloudflare. Would remove the Fasthosts dependency entirely |
| **Keep Fasthosts livemail** | Works today. Continues to work with DNS elsewhere, as long as the records are correct — but ties the club to a Fasthosts account it might otherwise close |

**Neither should be done now.** [Options](options.md#c8--email) already places email among
the cheapest capabilities to change and warns it should not influence larger decisions.
Changing MX records is a bigger and more visible change than changing where a website is
served from, and there is no reason to take that risk in the same season as everything
else.

One thing that *should* happen eventually, and costs nothing: **DMARC is at `p=none`**,
which is monitoring only. Once the DNS position is settled and reports are clean, moving
to `p=quarantine` would give the club's domain real protection against being spoofed. Not
now, and not during a migration — but it should be on a list somewhere.

---

## Summary

| Move | Risk | Reversal | When |
| --- | --- | --- | --- |
| **1. Add `nn` CNAME** | **None** | Seconds | **Now** — Nightingale Nightmare depends on it |
| **2. Repoint apex and `www`** | Low | Minutes | When the new site is built and proven, before April |
| **3. Move nameservers** | **Real — email** | Up to 48 hours | Only if Cloudflare is chosen. Pre-staged, quiet weekday, alone |
| **4. Transfer registrar** | Administrative | Days | Optional, later, for consolidation rather than the £7 |

And before any of them: **establish who holds the registration.** Five minutes, and it is
the one thing here that could go badly wrong without anyone having made a mistake.
