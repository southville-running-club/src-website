# Race Time Keeping App — Brand Guidelines

> Source of inspiration: Southville Running Club, Bristol (southvillerunningclub.co.uk).
> This document is the single source of truth for the app's visual and verbal identity.
> Update tokens here first, then propagate to `design-tokens.json` and the codebase.

⚠️ **That governance line is the source document's own, imported verbatim, and it does not
apply here.** This is `src-race-timing`'s brand file, adopted by reference into this
repository — **[`tokens.css`](../../platform/packages/shared/styles/tokens.css) is this
repository's canonical source, not this page.** A token change starts in `tokens.css` and
`design-tokens.json` together (they are asserted equal by
`packages/shared/tests/unit/brand.test.ts`); this page is a record of what was adopted and
why, not a place to edit from. **Not every value below was adopted as written** — see
`color/danger` in the quick-reference table, refused for insufficient contrast — so treat
this whole file as reference, and [`brand.md`](brand.md) as the authority on what actually
shipped.

**Adopted for `apps/main` on 16 August 2026**, superseding the "not compared" note in
[`brand.md`](brand.md). See that document for the reasoning, the derived AAA-safe text
colours this repository needed on top of the raw values below, and what stayed out of
scope (dark mode, and the full-bleed "dominant colour per screen" layout system in section
6, which is a layout change rather than a token one and was not attempted here).
**`nn-theme.css` is unaffected** — Nightingale Nightmare keeps its own campaign design.
**This repository targets AAA (7:1) for body text**, a stricter bar than this file's own
§Accessibility, which specifies AA (4.5:1) — see `brand.md` for what that meant for the two
colours it changed.

---

## 1. Brand Essence

**Personality:** Friendly, energetic, inclusive, community-driven, no-nonsense. Welcomes mixed abilities and ages — warm without being aggressive or "athletic-bro."

**Voice & tone:** Plain, encouraging, direct. Short conversational sentences. For a timing app this means clear status messages: "You're checked in," "Race starts in 2:00," "Great run — here's your time." Avoid corporate stiffness and avoid jargon.

**Brand keywords:** vibrant, social, motivating, bold, approachable, confident, precise.

---

## 2. Colour Palette

The brand is built on one dominant, saturated green with near-black text, used flat across full-bleed panels.

### Primary
| Token            | Hex       | RGB              | Use                                              |
|------------------|-----------|------------------|---------------------------------------------------|
| `color.primary`  | `#00C85A` | `0, 200, 90`     | Dominant background, primary CTAs, "live" states |
| `color.ink`      | `#2C2C2C` | `44, 44, 44`     | All text on green; primary neutral               |

### Supporting
| Token                  | Hex       | Use                                              |
|------------------------|-----------|--------------------------------------------------|
| `color.surface`        | `#FFFFFF` | Cards, sheets, secondary backgrounds             |
| `color.surface-muted`  | `#F4F6F2` | Long-read screens (results, leaderboards)        |
| `color.warning`        | `#FFB020` | Countdowns, "race starting soon"                 |
| `color.danger`         | `#E53935` | ⚠️ **Not adopted** — DNF, errors, cancel timing. This repository kept `--src-error` instead (see `brand.md`); read this row as source-document reference only |
| `color.slate`          | `#4A5568` | Tertiary text, dividers                          |

### Usage rules
- Lead with green for splash, hero panels, and the primary CTA. Use it boldly — full bleed, not a thin accent.
- Pair charcoal text on green; never small white text on green.
- Don't introduce gradients, glassmorphism, or drop shadows — the brand is flat and confident.
- Never rely on colour alone to signal state. Always pair with an icon or label.

---

## 3. Typography

| Role     | Family (preferred → fallback)                      | Weights     |
|----------|----------------------------------------------------|-------------|
| Display  | Halyard Display → Inter Display → Manrope → system | 600 / 700   |
| Body     | Halyard Display → Inter → system-ui                | 400 / 500   |
| Numerals | JetBrains Mono → IBM Plex Mono (tabular figures)   | 500 / 700   |

**Critical:** all running clocks, splits, paces, and result times must use **tabular figures** so digits don't reflow as numbers change.

### Type scale (mobile-first, in px)
| Role           | Size  | Weight | Notes                          |
|----------------|-------|--------|---------------------------------|
| Hero / timer   | 64–96 | 700    | tabular nums, tracking -0.02em |
| H1             | 40    | 700    | sentence case                  |
| H2             | 28    | 600    |                                 |
| H3             | 20    | 600    |                                 |
| Body           | 16    | 400    |                                 |
| Small / meta   | 13    | 500    | optional uppercase, +0.05em    |

Headings are sentence case (not uppercase) — keep that warmth.

---

## 4. Logo & Lockup

The brand is wordmark-led. No mascot. No icon required for the master lockup.

- Short brand name in heavy weight (700+).
- Optional descriptor underneath ("RACE TIMING" / "LIVE RESULTS") in a lighter, smaller setting.
- App tile icon: a single-colour geometric mark — stopwatch silhouette, finish-line chevron, or split-arrow. Charcoal on green, or green on white.

**Clear space:** at least the height of the smaller line of the wordmark on all sides.
**Minimum sizes:** 24px tall for icon mark; 80px wide for wordmark.

---

## 5. Imagery

- Authentic event photos: start line, crowd, finish funnel, medal moments.
- Real people, all body types and ages. Wide shots > solo hero shots.
- Naturalistic colour grade — no heavy filters, no stock photography.
- When photography isn't available, fall back on bold flat-colour panels.

---

## 6. Layout & UI Principles

- Generous whitespace, large type.
- Full-bleed colour blocks > boxed cards on coloured backgrounds.
- Minimal borders, no drop shadows, simple line icons.
- One dominant colour per screen with charcoal text.

### Screen archetypes
- **Splash / pre-race:** full green background, large wordmark, single primary action.
- **Live timer:** charcoal background, huge green-accented clock; secondary info (pace, split) in slate.
- **Results list:** white/off-white surface, charcoal type, green highlight on user's row or PB.
- **Buttons:** 8px corner radius; solid green with charcoal label, or charcoal outline on white.

---

## 7. Iconography & Motion

- **Icons:** 1.5–2 px line weight, rounded caps, geometric, monochrome charcoal.
- **Motion:** snappy and athletic. 150–250 ms ease-out for taps. Confident tick animation on lap captures. Avoid bounce / playful springs — timing apps must feel precise.

---

## 8. Accessibility

- ≥4.5:1 contrast for all text. Charcoal on green meets this at ≥18 px; for small text use white-on-charcoal or charcoal-on-white.
- Provide a high-contrast mode for outdoor sunlight.
- Tabular figures wherever a clock or time is shown.
- Never rely on green alone — pair with an icon (✓ finished, ▶ running, ⨯ DNF).
- Respect `prefers-reduced-motion`.

---

## 9. Microcopy Library

| State        | Copy                                             |
|--------------|---------------------------------------------------|
| Pre-race     | "You're all set. Race starts in 02:14."          |
| Start        | "Go! Have a great run."                          |
| Mid-race     | "5 km logged — keep it up."                      |
| Finish       | "Nice run. Your time: 24:18."                    |
| Sync error   | "Couldn't sync — we'll keep your time saved."    |
| DNF          | "Run ended early. We've saved what you covered." |

---

## 10. Quick Reference

| Token                | Value                                |
|----------------------|---------------------------------------|
| color/primary        | `#00C85A`                            |
| color/ink            | `#2C2C2C`                            |
| color/surface        | `#FFFFFF`                            |
| color/surface-muted  | `#F4F6F2`                            |
| color/warning        | `#FFB020`                            |
| color/danger         | `#E53935` — **not adopted**, see § Colours above |
| color/slate          | `#4A5568`                            |
| font/display         | Halyard Display, Inter Display       |
| font/body            | Halyard Display, Inter               |
| font/mono            | JetBrains Mono, IBM Plex Mono        |
| radius/button        | `8px`                                |
| radius/card          | `12px`                               |
| motion/tap           | `200ms ease-out`                     |

---

*Source document, unedited since adoption on 16 August 2026 — do not update tokens here;
see the note at the top of this file.*
