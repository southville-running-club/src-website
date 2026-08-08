# Runbook — adding a hostname

**Since 8 August 2026, DNS lives in Cloudflare.** This is the short answer to *"where do I
add the record?"*

> ## ⚠️ Never add records at Fasthosts again
>
> Fasthosts' DNS panel still looks entirely normal and is still editable. **It is no longer
> authoritative.** Anything changed there will save successfully and do absolutely nothing.
>
> Fasthosts now does exactly two things: it **holds the registration**, and it **runs the
> mailboxes**. Its DNS screen is a decommissioned control that nobody has removed.
>
> The Fasthosts zone is kept **until 8 September 2026** as the rollback, then cleared.

---

## Most of the time you do not add a record at all

The common cases create their own DNS. You attach the hostname to the *service*, and
Cloudflare writes the record and issues the certificate.

| What you are pointing at | How | Record created by |
| --- | --- | --- |
| **A Worker** | Worker → Settings → Domains & Routes → **Add Custom Domain** | **Cloudflare** |
| **A Pages project** | Pages project → Custom domains → **Set up a custom domain** | **Cloudflare** |
| Anything else — Vercel, an external host | DNS → **Add record**, by hand | You |

**This is simpler than it was before the move.** While the zone was at Fasthosts, a Pages
custom domain meant associating the domain in Cloudflare *and* hand-adding a CNAME at
Fasthosts, in that order, or you got a 522. That dance is gone.

---

## The proxy rule, which now has two halves

The nameserver move ran on one rule: **nothing is proxied.** That rule was about records
pointing at *other people's* infrastructure. Now that the club serves its own traffic, it
needs its second half.

| Record points at | Proxy | Why |
| --- | --- | --- |
| **A Cloudflare Worker or Pages project** | 🟠 **Proxied** | **Cloudflare is the origin.** This is how the certificate and routing work — Custom Domains set it automatically |
| **Squarespace** — apex, `www`, the verify CNAME | ⬜ **DNS-only** | Squarespace manages its own certificates. Proxying breaks its TLS |
| **Fasthosts mail** — `mail`, `mailserver`, `smtp`, `webmail` | ⬜ **DNS-only** | **Proxying stops mail.** Cloudflare proxies HTTP/HTTPS only; nothing listens on port 25 |
| **Any other third party** — Vercel, Resend | ⬜ **DNS-only** | They issue their own certificates |
| `mcp` | ⬜ **DNS-only** | Purpose still unknown — assume it matters |

**The short version: orange only when Cloudflare is the thing serving it.**

---

## Adding a record by hand

Cloudflare dashboard → the zone → **DNS** → **Add record**.

| | |
| --- | --- |
| **TTL** | **Auto** (300 s). Only lower it if a change is imminent |
| **Proxy** | Per the table above. Default is **on** — check it |
| **Additive only** | A name that does not resolve today cannot break anything. Deleting it restores the previous state exactly |

**Never modify or delete a mail record, an apex record, or `www`** without treating it as a
change to a live system. Those are the six-plus-eleven that carried the migration.

### Then, both of these

**1. Verify it resolves and serves.**

```bash
H=nn.southvillerunningclub.co.uk
dig +short "$H"
curl -sS -o /dev/null -w 'http=%{http_code} tls=%{ssl_verify_result}\n' "https://$H"
```

`200 0` means the certificate issued. `000 1` means it has not yet — wait a few minutes, and
**do not delete and retry**, which restarts issuance.

**2. Update the committed zone file** —
[ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md). Export
the zone from Cloudflare and commit it, so the repository still describes reality.

*The reviewable artefact is the point. A record added and never committed is a record nobody
else can see.*

---

## The `nn` case specifically

`nn.southvillerunningclub.co.uk` does **not** exist right now — the CNAME was removed with
the throwaway `test-nn` project, and the Cloudflare zone never had it.

When Nightingale Nightmare is rebuilt:

1. Create the Pages project (or Worker) from the monorepo
2. Attach `nn.southvillerunningclub.co.uk` as a custom domain **in the project**
3. **Do not add a CNAME at Fasthosts** — that was the old way and would now do nothing
4. Cloudflare creates a proxied record and issues the certificate
5. Verify, then commit the updated zone export

---

## Still to answer

| | |
| --- | --- |
| **What `mcp` serves** | 213.171.195.10, purpose unestablished. Nobody would notice if it broke |
| **The transactional sending subdomain** | For Resend. Cosmetic but permanent |
| **Whether the registrar moves to Cloudflare** | Optional. Now possible, since it requires the zone to be on Cloudflare first |
| **When the Fasthosts zone is cleared** | Proposed 8 September 2026, a month after the move |
