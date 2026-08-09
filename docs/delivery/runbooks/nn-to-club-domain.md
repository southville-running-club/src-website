# Retired — Nightingale Nightmare onto the club domain

**This runbook is retired, not deleted, because a runbook nobody corrects is worse than
none — it is trusted.** It described creating `apps/nn` as its own application and
attaching `nn.southvillerunningclub.co.uk` to it directly, in the shape
[ADR-006](../../architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md) chose
on 8 August 2026.

**[ADR-007](../../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md),
accepted the next day, replaced that shape before this runbook was ever run.**
`nn.southvillerunningclub.co.uk` is never created. Nightingale Nightmare lives at `/nn`, a
path inside `apps/main`, on the one hostname the whole club shares —
`new.southvillerunningclub.co.uk`.

## Where the procedure actually lives now

| This runbook's stage | Now covered by |
| --- | --- |
| Stage 0 — before you start | [Cloudflare setup](cloudflare-setup.md), step 1 |
| Stage 1 — create and deploy the Worker | Already done — `apps/main` exists and deploys via Workers Builds. See [Cloudflare setup](cloudflare-setup.md), steps 2–4, and [`apps/main`'s README](../../../platform/apps/main/README.md) |
| Stage 2 — the club hostname | [Cloudflare setup](cloudflare-setup.md), and see specifically the [`nn` case in *adding a hostname*](adding-a-hostname.md#the-nn-case-specifically) |
| Stage 3 — connect it to Supabase | Still ahead. [The build brief](../nn-build-brief.md) — the sign-up form, its RLS policy, and Stripe |

## Why keep this page at all

Because the old page is still linked from history — commits, closed pull requests, and
this file's own git log. Anyone who follows one of those links should land on an
explanation of what changed, not a 404 and not a procedure that would misconfigure a live
hostname if followed today.
