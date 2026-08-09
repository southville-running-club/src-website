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
H=new.southvillerunningclub.co.uk
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

> **Superseded by [ADR-007](../../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).**
> `nn.southvillerunningclub.co.uk` is **never created.** Nightingale Nightmare lives at
> `/nn`, a path on `new.southvillerunningclub.co.uk` — the one hostname the whole club
> shares, told apart by path rather than subdomain. This section is kept as the worked
> example of *"do not add a record you do not need"*: the throwaway `test-nn` project's
> CNAME was removed and never came back, and that was the right call.

This is already built and live — see the [Cloudflare runbook](cloudflare-setup.md) for the
procedure that created it:

1. `apps/main`'s `wrangler.jsonc` declares `new.<apex>` as a Custom Domain under
   `env.production` — one entry, reviewed as a pull request.
2. Cloudflare creates the record and the certificate from that entry on deploy. **No CNAME
   is added at Fasthosts, and none is added by hand at Cloudflare either.**
3. `/nn` is a page within that same application, not a second hostname or a second record.

---

## Still to answer

| | |
| --- | --- |
| **What `mcp` serves** | 213.171.195.10, purpose unestablished. Nobody would notice if it broke |
| **The transactional sending subdomain** | For Resend. Cosmetic but permanent |
| **Whether the registrar moves to Cloudflare** | Optional. Now possible, since it requires the zone to be on Cloudflare first |
| **When the Fasthosts zone is cleared** | Proposed 8 September 2026, a month after the move |
