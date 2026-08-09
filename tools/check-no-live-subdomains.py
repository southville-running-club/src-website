import re, os, pathlib, sys

"""
Fails if `nn.<apex>` or `timing.<apex>` appears as if it were a real, current address,
outside a short allowlist of files that are deliberately describing history.

## Why this exists

ADR-007 (docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md) is
explicit: **`nn.southvillerunningclub.co.uk` and `timing.southvillerunningclub.co.uk` are
never created.** Nightingale Nightmare and the timing platform live at `/nn` and `/timing`
on the one hostname the whole club shares.

Before this guard existed, eight files still described the superseded subdomain shape as
current or forthcoming — some of them the exact documents a committee member or a new
volunteer would read first. Nothing caught that except a human noticing on a full re-read,
which is how it survived. This makes ADR-007 self-enforcing instead: a stale reference
fails the same pipeline a code mistake would.

## What is allowed, and why an allowlist rather than a smarter regex

Plenty of files correctly mention these addresses — as history (the throwaway project that
proved the hosting path), as the shape of a decision that was superseded (the ADRs
themselves), or as a worked example of "this address does not exist" (the runbooks that
retired the old procedure). A regex cannot tell "this happened" from "this will happen";
a human reviewing a diff can. The allowlist is that review, made durable: adding a file to
it is a one-line pull request that says, in effect, "yes, this mention is deliberate."

Each entry below says why. If a new file needs adding and the reason does not fit one of
these shapes, that is worth a second look before adding it.
"""

EXCLUDED_DIRS = {
    'node_modules', '.git', 'dist', '.next', '.open-next', '.wrangler', '.astro',
    'coverage', 'playwright-report', 'test-results', '.temp', '.branches',
}

# Repo-relative paths where a mention is deliberate history, not a live address.
ALLOWLIST = {
    # The "solutions" and "investigations" folders record reasoning as it stood before
    # ADR-006/007 — the point of keeping them is that the reasoning is legible later.
    'docs/solutions/cloudflare-vs-netlify.md',
    'docs/solutions/dns-and-domain.md',
    'docs/solutions/platform-options.md',
    'docs/architecture/investigations/repositories.md',
    'docs/architecture/investigations/deployment.md',
    # Superseded ADRs are never edited to change their answer — a banner marks them, the
    # text stays as accepted. ADR-007 itself states the negative ("are never created"),
    # which is the correct, current statement and still trips a naive substring match.
    'docs/architecture/decisions/adr-001-one-monorepo.md',
    'docs/architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md',
    'docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md',
    'docs/architecture/decisions/adr-008-timing-port-before-the-race.md',
    # Early delivery planning, dated and reasoning from the state at the time.
    'docs/delivery/nn-first-delivery.md',
    'docs/delivery/priorities.md',
    'docs/delivery/dns-first.md',
    # Phase 1 is marked ✅ Done and describes the throwaway project by name.
    'docs/delivery/phases.md',
    # Historical step annotated with strikethrough, per this file's own convention.
    'docs/delivery/plan.md',
    # Each of these states the negative — "this is never created" / "there is no apps/nn"
    # — as the corrective the retirement itself is.
    'docs/delivery/nn-build-brief.md',
    'docs/delivery/runbooks/adding-a-hostname.md',
    'docs/delivery/runbooks/README.md',
    'docs/delivery/runbooks/nn-to-club-domain.md',
    'docs/architecture/README.md',
    'docs/reference/zone-fasthosts-2026-08-08.txt',
}

PATTERN = re.compile(
    r'\bnn\.(?:southvillerunningclub\.co\.uk|<apex>)'
    r'|\btiming\.(?:southvillerunningclub\.co\.uk|<apex>)',
)

root = pathlib.Path('.')
candidates = [
    p for p in list(root.rglob('*.md')) + list(root.rglob('*.txt'))
    if not EXCLUDED_DIRS & set(p.parts)
]

bad = []
for f in candidates:
    rel = f.as_posix()
    if rel in ALLOWLIST:
        continue
    text = f.read_text()
    matches = sorted(set(PATTERN.findall(text)))
    if matches:
        bad.append(f'{rel}: {", ".join(matches)}')

if bad:
    print('Found live-looking subdomain references outside the allowlist:')
    print('\n'.join(f'  {line}' for line in bad))
    print(
        '\nnn.<apex> and timing.<apex> are never created — ADR-007. If this mention is '
        'deliberate history, add the file to ALLOWLIST in tools/check-no-live-subdomains.py '
        'with a one-line reason; otherwise use new.<apex>/nn or new.<apex>/timing.'
    )
    sys.exit(1)

print(f'ALL CLEAR — {len(candidates)} files checked, {len(ALLOWLIST)} allowlisted')
