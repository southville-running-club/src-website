# ADR-0007 — Stripe for payments

- **Status:** Proposed — gated on governance prerequisites
- **Date:** 2026-08-05
- **Owner:** Treasurer, with the platform volunteer
- **Blocks:** Nothing yet — this is gated, not blocking

## Context

The club has two payment flows to move and one to create:

- **The £2.50 member fund**, currently a Squarespace donation fund. 94 active recurring
  payers, every one at exactly £2.50, roughly £2,820 a year — a larger line than the
  Squarespace subscription itself. Fees today run ~30–40p per payment (~12–16%),
  roughly £340–£450 a year, all absorbed by the club: 0% of payments use Squarespace's
  "cover the fees" option.
- **Race entries**, currently through Full On Sport at 5.9% + 20p plus VAT — an
  effective 8.3–10.1%. Confirmed by the race director: **this fee is added on top of the
  entry price and paid by runners, not by the club.**

Stripe's published UK rates are 1.5% + 20p per standard UK card, no monthly fee. A
disputed payment costs about £20 regardless of outcome. Stripe's charity discount applies
to donations only — registration and ticket fees are explicitly excluded — so standard
rates are the right planning numbers.

| Payment | Full On Sport | Stripe | Saving |
| --- | --- | --- | --- |
| PtB team, £16 | ~£1.37 (8.6%) | 44p (2.8%) | ~93p |
| PtB team, £18 | ~£1.51 (8.4%) | 47p (2.6%) | ~£1.04 |
| PtB team, £20 | ~£1.66 (8.3%) | 50p (2.5%) | ~£1.16 |
| NN solo, £8 | ~81p (10.1%) | 32p (4.0%) | ~49p |
| NN solo, £10 | ~95p (9.5%) | 35p (3.5%) | ~60p |

| Member fund route | Fee per payment | Per year, 94 payers |
| --- | --- | --- |
| Squarespace (today) | ~30–40p (~12–16%) | ~£340–£450 |
| Stripe, £2.50 monthly | ~24p (9.5%) | ~£268 |
| Stripe, half on £30 annual | — | ~£165 |
| Stripe, all on £30 annual | 65p/yr (2.2%) | ~£61 |

Small payments are fee-heavy everywhere because the fixed 20p dominates. Moving platform
holds the line; **the £30 annual option is what actually cuts the rate**.

## Decision (proposed)

**Stripe is the club's payment processor**, in two stages:

1. **Stripe-hosted Payment Links** for the member fund — created in the dashboard, no
   code, no hosting dependency. This can proceed independently of everything in this
   repository.
2. **Stripe hosted checkout** for race entries, on our own site, later and strictly
   gated.

The entry form validates each runner's EA URN live and prices the team accordingly
(£8 registered / £10 non-registered), taking **one transaction per team** — preserving
today's shape, which halves the number of fixed 20p fees.

### Hard prerequisites — no payment code starts before all three

- Data-protection advice taken on collecting and retaining entrant personal data,
  covering the EA data-sharing angle.
- A club Stripe account under treasurer oversight.
- A written refund policy and entry terms agreed.

[P13](../principles.md#p13--governance-gates-come-before-the-code-they-enable). Agreed
at the QGM.

## Consequences

- Effective rates fall from ~8.5–10% to ~2.5–4% on entries and from ~12–16% to ~9.5%
  (or ~2.2% on the annual price) on membership.
- **Moving entries to Stripe does not cut a club cost** — Full On Sport's fee is already
  borne by runners. It creates a pot of roughly £150/yr that the board allocates
  explicitly: hold total prices level and bank it, or cut entry prices and hand it to
  runners ([Q19](../open-questions.md)).
- The club takes on payment operations — refunds, failed payments, disputes — owned by
  the treasurer, with reconciliation tooling against Stripe payouts
  ([R6](../risks.md#r6--payment-operations)).
- The fund migration carries real exposure: all 94 payers must actively re-subscribe
  ([R2](../risks.md#r2--member-fund-migration)).
- Webhook handling must be idempotent and tested as such; entries are only confirmed on
  a verified webhook, never on a browser redirect.
- Card data never touches our systems — hosted pages and hosted checkout only.
- Taking payments on our own site is the trigger for
  [ADR-0002](0002-hosting-platform.md).

**Free win available today, before any of this:** switch on Squarespace's "cover the
fees" option on the existing fund.

## Revisit if

Stripe's UK rates change materially, the club's volume grows enough to negotiate, or the
charity discount becomes applicable to more than donations.
