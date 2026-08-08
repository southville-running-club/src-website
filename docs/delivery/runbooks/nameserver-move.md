# Runbook — moving the nameservers from Fasthosts to Cloudflare

**The riskiest change in the programme.** It carries club email, and it is the only change
here that takes up to 48 hours to reverse.

**Why** it is worth doing and why now is [move the DNS
first](../dns-first.md). **What** each DNS move risks is [DNS and
domain](../../solutions/dns-and-domain.md). **This** is the checklist.

| | |
| --- | --- |
| **What changes** | One setting at Fasthosts: the nameservers |
| **What does not change** | Registration, mail routing, where the website is served, every record's value |
| **Effort** | Three evenings and one morning, spread over ~2 weeks because of two waiting periods |
| **Reversal** | **Up to 48 hours.** Which is why phases 1–4 carry the weight, not phase 5 |

> **The work is entirely in the diff, not in the switch.** The switch itself causes no
> downtime — during propagation both providers answer, and if they answer identically nobody
> notices. **A wrong record causes downtime**, for as long as it takes to notice plus the time
> to fix.

---

## Stop conditions — do not start if any of these is true

| | |
| --- | --- |
| ❌ | It is **race week**, the week before, or the week after |
| ❌ | It is **within a fortnight of the Squarespace renewal** (21 March 2027) |
| ❌ | It is **the week Nightingale Nightmare launches** — if something breaks, debug one thing |
| ❌ | It is **Friday**, or the day before anyone is away |
| ❌ | The **mailbox purchase is not finished and verified** — Fasthosts must have written its own mail records while it still controls the zone |
| ❌ | A **registrar transfer or mail-provider change** is planned in the same window. One mail-affecting change at a time |
| ❌ | The **second volunteer is unavailable** for phase 4 |

**Choose a quiet weekday morning with the rest of the day free.**

---

## What the zone actually looks like

Measured against the authoritative nameservers, 7 August 2026. Three of the four things that
usually wreck this migration **do not apply here**.

| | Measured | Consequence |
| --- | --- | --- |
| Nameservers | `ns1`, `ns2`, `ns3.livedns.co.uk` | Fasthosts, three of them |
| **DNSSEC** | **Not enabled** | **The worst failure mode cannot happen.** A stale `DS` record makes a domain vanish entirely for validating resolvers |
| **CAA records** | **None** | Nothing can block Squarespace's certificate renewal — **and do not add one** |
| Record TTL | **3600**, uniform | Governs how fast a *record* fix propagates |
| **Registry delegation TTL** | **172,800 — exactly 48 hours** | **Not under club control.** Governs the switch and the rollback |
| Hidden records | **None found** — a 15-host probe returned nothing | The documented 18 appear to be the whole zone |
| Zone transfer | Refused | Capture from the panel; it cannot be pulled |

**Two clocks, and confusing them is how people mis-plan this.** The 3600 s record TTL is
yours to lower and drains in about an hour. The 48-hour delegation TTL is the registry's and
cannot be shortened.

---

## Phase 1 — capture and commit the zone

*An evening. Zero risk. This is the rollback reference and the diff baseline.*

**1.1** Export the zone from Fasthosts, or transcribe every record from the control panel.
*Confirm whether Fasthosts offers a zone-file export — its panel is not publicly documented.*

**1.2** Commit it to this repository as `docs/reference/zone-fasthosts-<date>.txt`.

**1.3** Confirm the count. **There should be 18 records.** A different number means find out
why before continuing.

**1.4** Verify what you wrote down against a live lookup — do not trust the panel alone:

```bash
D=southvillerunningclub.co.uk
NS=ns1.livedns.co.uk

for h in @ www mail mailserver smtp webmail mcp; do
  n=$([ "$h" = "@" ] && echo "$D" || echo "$h.$D")
  echo "== $n"; dig @$NS +short "$n" A; dig @$NS +short "$n" CNAME
done
dig @$NS +short "$D" MX
dig @$NS +short "$D" TXT
dig @$NS +short "_dmarc.$D" TXT
for i in 1 2 3 4; do dig @$NS +short "livemail$i._domainkey.$D" CNAME; done
```

> **Stop condition.** If the committed file and the live lookup disagree, resolve it now. A
> baseline you do not trust is worse than none.

---

## Phase 2 — lower the TTLs

*Fifteen minutes, then about an hour of waiting. Zero risk.*

**2.1** Set **every** record's TTL to **300 seconds** at Fasthosts.

**2.2** Wait about an hour — the old value was 3600, so caches holding it drain within that.
**Waiting longer buys nothing.** (The 48-hour figure elsewhere refers to the delegation TTL,
which is a different clock and not affected by this.)

**2.3** Confirm:

```bash
dig @ns1.livedns.co.uk southvillerunningclub.co.uk A | grep -E '^southville' 
#   the TTL column should read 300
```

---

## Phase 3 — stage the zone in Cloudflare

*An evening. Zero risk — nothing is authoritative yet.*

**3.1** Add the domain to Cloudflare. **Do not change the nameservers when prompted.**

**3.2** **Import the committed zone file, with proxying off.**

DNS → Records → **Import and Export** → Import → select the file → **unselect "Proxy imported
DNS records"**.

> **This is the single most valuable step in the runbook.** Cloudflare's onboarding scan turns
> the proxy **on** by default for every proxiable record, and
> [eleven of the eighteen are proxiable](../dns-first.md#the-proxy-default-is-the-real-hazard).
> Proxying a mail record breaks club email **silently**. Importing with proxying off means
> nothing arrives orange, which replaces an eleven-item manual checklist with one checkbox.
>
> It does **not** replace phase 4. Verify anyway.

*Zone files: 256 KiB limit, API rate limit 3 requests/minute. Both irrelevant at 18 records.
CNAME, MX and NS targets need fully-qualified names with a trailing dot.*

**3.3** Compare the imported count against 18 and **add anything missing by hand.** Assume
something was missed.

**3.4** Confirm **every record is DNS-only (grey)**. The safe state is *nothing proxied* —
including the apex and `www`, because Squarespace is still serving them.

**3.5** **Decline Cloudflare Email Routing** if offered. It would **replace the MX records**.

**3.6** **Do not add a CAA record.** The zone has none, which is why nothing blocks
Squarespace's certificate renewal. Adding one could break it quietly, weeks later.

**3.7** Note Cloudflare's assigned nameservers. You will need them in phase 4 and phase 5.

---

## Phase 4 — diff, and have someone else check it

*Same evening. **This is the phase that decides whether phase 5 is safe.***

**4.1** Query both nameserver sets and compare. Do not eyeball the dashboard.

```bash
D=southvillerunningclub.co.uk
OLD=ns1.livedns.co.uk
NEW=<cloudflare-ns>          # from step 3.7

fail=0
check() {  # $1 = name, $2 = type
  a=$(dig @$OLD +short "$1" "$2" | sort)
  b=$(dig @$NEW +short "$1" "$2" | sort)
  if [ "$a" != "$b" ]; then
    printf 'DIFFERS  %-40s %-6s\n  old: %s\n  new: %s\n' "$1" "$2" "${a:-<none>}" "${b:-<none>}"
    fail=1
  fi
}

for h in "" www. mail. mailserver. smtp. webmail. mcp.; do
  check "$h$D" A; check "$h$D" CNAME
done
check "$D" MX
check "$D" TXT
check "_dmarc.$D" TXT
for i in 1 2 3 4; do check "livemail$i._domainkey.$D" CNAME; done

[ $fail -eq 0 ] && echo "IDENTICAL — safe to proceed" || echo "RESOLVE THE ABOVE FIRST"
```

**4.2** Confirm no record returns a **Cloudflare** address. If the apex resolves to a
Cloudflare IP against the new nameservers, something is proxied.

**4.3** **The second volunteer runs the same check independently**, from their own machine.

This is exactly the change the [review
requirement](../../foundations/requirements.md#everything-is-defined-as-code) exists for, and
the only step in the programme where an independent check is non-negotiable.

> **Stop condition.** Anything other than `IDENTICAL` means do not proceed.

---

## Phase 5 — the switch

*Fifteen minutes. **The only step that carries real risk.***

**5.1** Confirm none of the [stop conditions](#stop-conditions--do-not-start-if-any-of-these-is-true)
has become true.

**5.2** At **Fasthosts**, change the nameservers to Cloudflare's.

*Look for nameserver or delegation settings on the domain, not in the DNS-records screen —
**confirm the exact location in the panel**. Replace all three `livedns.co.uk` entries with
Cloudflare's two.*

**5.3** **Send and receive a test message on a club address. Immediately.**

**Mail first, always.** Everything else can wait a few minutes; this cannot.

**5.4** Confirm the website still resolves to **Squarespace**:

```bash
dig +short southvillerunningclub.co.uk A
#   expect: Squarespace's four addresses
#   a Cloudflare address means something is proxied — fix at Cloudflare now
```

**5.5** Load the site over HTTPS, **from mobile data as well as home broadband** — different
resolvers, and during propagation they may be asking different nameservers.

**5.6** Confirm the delegation actually changed:

```bash
dig +short NS southvillerunningclub.co.uk
whois southvillerunningclub.co.uk | grep -iA3 'name server'
```

---

## Phase 6 — watch for 48 hours

*Passive. **Both nameserver sets are live during this window and must keep agreeing.***

**6.1** Send **and** receive on club addresses daily.

**6.2** Read DMARC reports. `p=none` means reports arrive and nothing is rejected — use them
rather than waiting for somebody to say a reply never came.

**6.3** **Edit neither zone.**

- **Not Fasthosts** — it is not a stale copy yet; it is still answering for half the internet.
- **Not Cloudflare** either, unless fixing something broken. A change there is invisible to
  anyone still resolving through Fasthosts.

**6.4** Re-run the phase 4 diff once a day. It should stay `IDENTICAL`.

---

## Phase 7 — settle

*An evening, after the 48 hours.*

**7.1** Raise TTLs back to something sensible — 3600.

**7.2** **Export the zone from Cloudflare and commit it.** This replaces the Fasthosts export
as the live reference and is the artefact that makes future record changes reviewable —
[ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md).

**7.3** **Leave the Fasthosts zone intact for at least a month.** It is the rollback.

**7.4** Write down, in this repository, **which provider is authoritative** — and put a note
in the Fasthosts account too.

> **The footgun this defuses:** once the 48 hours pass, the Fasthosts zone becomes a divergent
> copy that is still editable. A volunteer editing DNS in the familiar panel would see the
> change save successfully and **do nothing at all.**

---

## Rollback

| Stage | If it goes wrong | Effective in |
| --- | --- | --- |
| Phases 1–4 | Delete the Cloudflare zone. Nothing is live | **Immediately** |
| After the switch — a wrong record | **Fix it at Cloudflare.** It is authoritative now | **~300 seconds** (the lowered TTL) |
| After the switch — something fundamental | Point the nameservers back at Fasthosts, whose zone is untouched | **Up to 48 hours** |

> **Repair forward, not back.** Once Cloudflare is authoritative, correcting a record there is
> two orders of magnitude faster than reverting the delegation. Reverting is the last resort —
> which is exactly why phases 1–4 carry the weight.

---

## Impact on the Squarespace site

**None, if nothing is proxied.** This is the crux of the whole plan.

```
BEFORE
  browser → resolver → ns1.livedns.co.uk → "198.185.159.144"
  browser ─────────────────────────────────────────→ Squarespace

AFTER, every record DNS-only
  browser → resolver → Cloudflare NS     → "198.185.159.144"   ← identical answer
  browser ─────────────────────────────────────────→ Squarespace   ← identical connection

IF PROXIED — must not happen
  browser → resolver → Cloudflare NS     → "104.x.x.x"         ← Cloudflare's address
  browser → Cloudflare edge ───────────────────────→ Squarespace   ← TLS terminated between
```

**In the middle case Cloudflare never touches a packet of club traffic.** It answers a
question and steps out of the way. Squarespace receives exactly the connection it receives
today and presents its own certificate. **It cannot tell anything changed.**

**There is no cutover moment for the website.** Its address is the same before and after —
what changes is *who gets asked*, not what the answer is. So during propagation both
nameserver sets give the same answer and both work.

Two cautions that come with it:

| | |
| --- | --- |
| **Squarespace will not support the club on Cloudflare** | Its own guide puts Cloudflare outside its support scope. While Squarespace still serves the live site, an odd fault leaves two vendors pointing at each other. The mitigation is the rollback |
| **Do not add CAA records** | Could break Squarespace's SSL renewal quietly, weeks later |

---

## What must not happen

- **Nothing is proxied.** Not the apex, not `www`, and above all **not the mail records**.
- **The apex is not repointed in the same change.** Two changes means an outage with two
  candidate causes. The apex moves months later, when the new site is proven.
- **Not in the same week as the Nightingale Nightmare launch.**
- **Not in race week, not on a Friday**, not near the Squarespace renewal.
- **The Fasthosts zone is not deleted** for at least a month.
- **Neither zone is edited** during the 48-hour window.

---

## Done when

- [ ] The committed Fasthosts export matched a live lookup, at **18 records**
- [ ] Cloudflare answers **identically** to Fasthosts on every record
- [ ] **Both volunteers** verified the diff independently
- [ ] Nameservers changed, and `whois` confirms it
- [ ] **Club email sent and received** after the switch
- [ ] The apex resolves to **Squarespace**, not Cloudflare
- [ ] 48 hours passed with no divergence and no zone edits
- [ ] TTLs raised; **the Cloudflare zone exported and committed**
- [ ] The Fasthosts zone **left intact**, with a note saying it is no longer authoritative
- [ ] What was done by hand is written down

## What this unblocks

| | |
| --- | --- |
| **Workers custom domains** | Previously impossible on the club domain |
| **The current Astro Cloudflare adapter** | The [Pages/Workers pincer](../nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything) disappears, and the main website can start on the path Cloudflare actually supports |
| **Cron Triggers** | A Workers feature — the newsletter mirror stops needing a GitHub Actions workaround |
| **The March apex cutover** | Becomes a record change **inside** Cloudflare. Seconds to make, seconds to reverse |
| **DNS as a reviewable artefact** | [ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) |
