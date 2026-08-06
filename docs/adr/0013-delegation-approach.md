# ADR-0013 — How and when to delegate DNS

- **Status:** **Proposed — decision open**
- **Date:** 2026-08-06
- **Owner:** Platform volunteer, with the committee
- **Depends on:** [ADR-0005](0005-dns.md), which settles *that* delegation happens
- **Blocks:** Nightingale Nightmare on `nn.southvillerunningclub.co.uk`, and everything behind it

## Context

[ADR-0005](0005-dns.md) establishes that delegation is unavoidable at any price. What
remains is *how carefully* and *when* — and that is a judgement about appetite, not a
technical fact, so it is written here with the options open rather than decided.

### The dual-answer window

This is the concept the whole risk turns on, and it is not "a moment of switchover".

Recursive resolvers cache the delegation, and `.co.uk` publishes it with a **48-hour TTL**.
For up to two days after the change:

- resolvers that already cached "Fasthosts" keep asking **Fasthosts**
- resolvers that had not start asking **Cloudflare**
- **both are authoritative for different people at the same time**

If the two zones are identical, nobody can tell and the transition is genuinely invisible.
If they differ anywhere, the symptom is the worst kind in networking: some people fine,
some broken, no pattern, shifting as caches expire.

Two rules follow, and they are not negotiable under any option below:

1. **Copy records exactly and change nothing else at the same time.** Not the SPF tidy-up,
   not dropping the unexplained `mcp` record, nothing. Make Cloudflare a mirror, delegate,
   then start changing things once it is sole authority.
2. **Do not delete the Fasthosts zone afterwards.** It is still serving cached resolvers
   for two days, and it is the rollback.

### Rollback is slow; fixing forward is fast

Switching nameservers back takes seconds but reconverges over the same 48 hours, so
reverting the *delegation* is not a quick escape.

It is also rarely the right move. The 48 hours applies to the delegation, not to the
records — individual record TTLs are short and ours to set. A missing record spotted at
hour three is added in Cloudflare in thirty seconds and live within minutes for everyone
already on Cloudflare, while Fasthosts serves the rest unchanged. **The fast path is
forward.**

### It can be proved safe before committing

Once a zone is added to Cloudflare, **its nameservers answer queries for it immediately**,
before any delegation. So both sides can be interrogated directly and compared. If all 18
records match, delegation is a no-op by construction.

Find the current nameservers:

```bash
dig +short NS southvillerunningclub.co.uk
```

Dump every record from a given nameserver — run once against Fasthosts, once against each
Cloudflare nameserver, and diff:

```bash
NS=ns1.fasthosts.co.uk; D=southvillerunningclub.co.uk; for r in "@ A" "@ MX" "@ TXT" "@ CAA" "www CNAME" "mail A" "mailserver A" "smtp A" "webmail A" "mcp A" "_dmarc TXT" "9sw9cgfs3d8e53r2xcx5 CNAME" "livemail1._domainkey CNAME" "livemail2._domainkey CNAME" "livemail3._domainkey CNAME" "livemail4._domainkey CNAME"; do set -- $r; h=$1; t=$2; n=$D; [ "$h" = "@" ] || n="$h.$D"; printf '%-46s %-5s ' "$n" "$t"; dig +short @$NS "$n" "$t" | sort | tr '\n' ' '; echo; done
```

Identical output from both sides is strong evidence — considerably better than "we think we
copied everything".

## Options

### Option A — Populate, prove, delegate

Add the zone, copy all 18 records grey, run the diff until both sides are identical, switch
the nameservers, watch for 72 hours.

| For | Against |
| --- | --- |
| No cost, no delay | The first time anyone does this is on the live domain |
| The pre-flight diff proves it is a no-op before committing | Delegation rollback is up to 48 h if something systemic goes wrong |
| Nightingale Nightmare gets its hostname soonest | Nobody has rehearsed attaching a Workers Custom Domain |

### Option B — Rehearse on a throwaway domain first

Register a domain for around £10, run the whole sequence end to end — add zone, populate,
delegate, attach a Worker Custom Domain, verify — then repeat on the club domain.

| For | Against |
| --- | --- |
| Removes "first time" from the change that matters | ~£10 and roughly a week of delay |
| Teaches Workers Custom Domains with nothing at stake | An empty rehearsal zone does not replicate a live zone carrying mail — the genuinely hard part is untested |
| Leaves a permanent sandbox for future experiments | A second domain to renew and remember |

### Option C — Defer delegation

Nightingale Nightmare launches on its free `*.workers.dev` address, or behind a redirect
from a Squarespace page. Delegation waits until the website rebuild.

| For | Against |
| --- | --- |
| Club domain untouched through race season | Nightingale Nightmare is not on an SRC domain in 2026 — contradicting the milestone everything else is sequenced behind |
| Zero DNS risk in the eleven weeks before the race | The address bar shows `workers.dev`; the redirect option is a fudge |
| Delegation happens with no race pressure | Delays every other hostname too, including `beta.` |

## Not options — apply under all three

- **Lower every record TTL at Fasthosts to 300 s, at least 48 hours ahead.** This does not
  shorten the delegation window, which the registry controls, but it makes every
  record-level fix propagate in minutes — and record-level fixes are the failure mode
  actually likely to occur.
- **Choose a window with no committee mailing, no race and no membership renewal**, and
  where whoever holds Fasthosts access is available for the following three days.
- **Get a second person onto the Fasthosts account first.** It is the rollback route, and a
  rollback route only one person can reach is not a rollback route
  ([R1](../risks.md#r1--key-person-dependency)).

## Verification, whichever option is chosen

Silence is not success. Check deliberately at **0 h, +1 h, +24 h and +72 h**:

| Check | Why |
| --- | --- |
| Re-run the record diff, against public resolvers as well as the nameservers directly | Catches cache-split discrepancies during the dual-answer window |
| **Send real mail to a forwarding address and confirm it arrives** | The failure that hides. Do this before the change too, for a baseline |
| Send mail *from* a club address and check headers for SPF/DKIM pass | Catches authentication degradation that DMARC `p=none` will not surface |
| Load `https://southvillerunningclub.co.uk` and confirm the 301 to `www` | Confirms apex and `www` both resolve correctly |
| Log in to webmail | Confirms `webmail` resolves |
| Check Squarespace still reports the domain as verified | The token CNAME is working |

## If something goes wrong

| Symptom | Action |
| --- | --- |
| A record is missing or wrong | **Fix forward in Cloudflare.** Seconds to change, minutes to propagate. Do not revert the delegation |
| Mail not arriving | Check `mail` is **grey**, then check the MX. Almost always the proxy setting |
| Mail arriving but landing in spam | Compare SPF and DKIM records byte-for-byte against the Fasthosts export. `p=none` means nothing is being rejected — there is time |
| Squarespace reports the domain unverified | Re-add the `9sw9cgfs3d8e53r2xcx5` CNAME as **grey**, then re-verify from the Squarespace panel |
| Something systemic and unexplained | Revert the nameservers at Fasthosts and accept up to 48 h to reconverge. The Fasthosts zone is still intact — this is why it is not deleted |

## Decision

**Open.** The three options differ in appetite rather than in outcome, and the choice
belongs to whoever will carry the change and answer for it if club email stops for an
afternoon.

## Revisit if

Nightingale Nightmare's date moves, changing how much race-season risk is tolerable; or the
`mcp` record turns out to serve something that changes the audit.
