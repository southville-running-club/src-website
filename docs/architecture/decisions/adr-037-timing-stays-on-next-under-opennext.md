# ADR-037 — The timing app stays on Next.js under OpenNext, and does not adopt Tailwind

**Accepted**, 10 September 2026. Supersedes no ADR. Settles the framework, styling and test
questions that [ADR-034](adr-034-the-timing-platform-is-rewritten-on-cloudflare.md) opens by
choosing a rewrite over a port.

| | |
| --- | --- |
| **Requirement** | [C5](../../foundations/requirements.md#c5--capture-race-timing-data-tolerant-of-no-signal), [C6](../../foundations/requirements.md#c6--show-live-race-progress-to-spectators), [people](../../foundations/requirements.md#people), [exit cost](../../foundations/requirements.md#exit-cost) |
| **Supersedes** | No ADR |

## Context

A rewrite is the moment the framework is genuinely open, so it is worth answering rather than
inheriting. `apps/main` is static Astro plus a hand-written Worker; `apps/timing` is Next.js 16
under `@opennextjs/cloudflare`, chosen when the hello-world Worker proved the route. **Two
frameworks in one workspace is a real cost** — a second build, a second set of conventions, a
second thing a third volunteer has to know — and *boring beats optimal* says to check whether
one would do.

It would not, and the reason is what the two applications are.

`apps/main` is pages with a few forms on them, which is what Astro is for and why every test
here runs in a `no-javascript` project. The timing app is the opposite shape: a marshal capture
screen driven by client state and an IndexedDB queue, a live leaderboard over a socket, a
roster editor, and a registration import with preview and reconcile steps. Those are four of
the five largest source files in the old repository, and none of them is a page with a form on
it. **Rebuilding them as Astro islands would mean writing a framework's worth of glue to reach
the place a framework already is.**

## Decision

**Next.js 16 App Router under `@opennextjs/cloudflare`, on the workspace's own versions.
Styling is this repository's CSS. Tests are this repository's four layers.**

| | |
| --- | --- |
| **Next under OpenNext** | Already proven on this route by the hello-world Worker. Not `@cloudflare/next-on-pages`, which is deprecated and Edge-runtime only |
| **Versions come from the workspace** | Not the old app's pinned `next@16.2.4` / `react@19.2.4`. After any version change, `npm dedupe` and confirm one copy — two copies of React or Next break the build in ways that read as application bugs |
| **No Tailwind** | The old app's Tailwind v4 `@theme` layer is not adopted. Styling is `packages/shared/styles` plus the app's own stylesheet, in `--colour-*` names, the way `nn-admin.css` is |
| **Contrast is asserted, not reviewed** | Every wash the timing surface mixes gets a case in a contrast test, the way `admin-contrast.test.ts` and `nn-contrast.test.ts` work. A component carries its own surface rather than taking one as a prop |
| **Tests join the four layers** | Unit, database against real Postgres, the Workers runtime via Miniflare, Playwright with axe. The old app's `TZ=UTC` pin comes with its copied pure functions |
| **Middleware stays thin** | Whatever survives is **edge** middleware; OpenNext does not support Node middleware. Authorisation is checked in the application per [ADR-036](adr-036-timing-staff-are-identity-permissions.md), not in a middleware reading a second table |

**Two frameworks is the accepted cost**, and it is smaller than it looks: `apps/main` does not
use React at all, so the two dependency trees barely overlap, and Next is the more mainstream
of the two skills for a third volunteer to arrive with.

**One measurement gates this, and it has not been taken.** The free Workers plan allows **3 MB
compressed** and **10 ms CPU**, and the
[architecture review](../../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know)
names both as unmeasured for this application. **Measure them against real code early** — a
bundle built from the copied domain logic and one server-rendered page is enough. If the answer
fails, the response is the paid Workers plan (a money decision for the committee) or moving
work off the server, **not a framework change mid-rewrite.**

## Consequences

- **Zero accessibility violations applies to a much more interactive surface** than this
  repository has tested before. A marshal screen driven by client state is where that gets
  hard, and it is deliberately not a threshold to relax.
- **The `no-javascript` project cannot cover the capture path.** Offline capture *is*
  JavaScript. What can still be covered without it: the public leaderboard's server-rendered
  state, and every gated route answering 404 to somebody who may not be there.
- **`basePath: '/timing'`** stays, and every route, link and asset is prefixed by it.
- **The service worker's scope is `/timing/`**, which is the single most important thing to
  rehearse rather than assume — it is the offline capture queue.
- **A second stylesheet is a second place a colour can be wrong**, which is why the contrast
  test is named here as part of the decision rather than left to review by eye. This repository
  has already shipped a component whose colours were computed against a surface it did not
  carry.
- **Prettier's `html` tag reflow does not apply** — that trap belongs to `worker/html.ts` in
  `apps/main`, and nothing in a Next app builds markup that way.

## Exit cost

**Moderate, and asymmetric.** Moving off Next later means rewriting the interactive surfaces,
which is most of the application. Moving off *OpenNext* — to another Next host — is cheap and
is exactly what this programme is doing in the other direction. The lock-in is to Next, not to
Cloudflare, which is the right way round given
[exit cost](../../foundations/requirements.md#exit-cost) names vendor lock-in as the concern.

## Revisit when

- **The bundle or CPU measurement fails**, which makes this a money decision rather than a
  technical one.
- **A third volunteer arrives who knows Astro and not Next**, which is the people argument
  running the other way.
- **`apps/main` ever needs a genuinely interactive surface**, at which point the workspace is
  paying for two frameworks to do one job and the question is worth re-asking.
