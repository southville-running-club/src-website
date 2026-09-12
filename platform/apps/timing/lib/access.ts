/**
 * Which permission each address under `/timing` demands.
 *
 * ## Why this is a table and not a check in each page
 *
 * [ADR-017](../../../../docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md):
 * **code checks the permission, never the role.** The door in `middleware.ts` used to admit
 * anybody holding *any* `timing.*` permission, which was right for a holding page and stops
 * being right the moment a page does something — a `timing-marshal` holds one permission,
 * `timing.crossing.record`, and reached the same addresses as a `timing-admin`.
 *
 * ⚠️ **The obvious fix — each page checks itself — does not work in this application, and the
 * reason is measured rather than theoretical.** A page here cannot refuse: `notFound()` thrown
 * during a *dynamic* render, and reading cookies makes every render dynamic, returns an empty
 * `<html id="__next_error__">` shell with the page in the streamed RSC payload. Signed out
 * that produced **no `<h1>`, no banner and no footer in the HTML**, and with JavaScript off —
 * a whole Playwright project here — a blank page. `middleware.ts`'s header carries the
 * measurements and `app/page.tsx`'s header forbids the belt-and-braces check that was already
 * tried once.
 *
 * So the refusal stays in one place, where the only proven mechanism lives, and what each page
 * would have checked becomes **data** instead: this table. Adding a page means adding a row,
 * and a page with no row is refused rather than opened — see `surfaceFor`.
 *
 * ## The one rule that is not a permission
 *
 * `/timing/marshal/<slug>/` needs `timing.crossing.record` **and** a `timing.marshals` row for
 * that event. [ADR-036](../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md)
 * makes the roster a **scope checked after the permission**, not an authority of its own. This
 * module says *that a roster check is owed* and does not perform one: reading `timing.marshals`
 * needs a function that does not exist yet, which is
 * [#245](https://github.com/southville-running-club/src-website/issues/245). Until it lands,
 * `rosterScoped` is carried and the caller is what decides — see `middleware.ts`.
 */

/**
 * The landing page's rule: any `timing.*` permission at all.
 *
 * A sentinel rather than `null`, because `null` in a `permission` field reads as *"no
 * permission required"* — which is the opposite of what this address means, and is the kind of
 * mistake that opens a door rather than closing one. The string is deliberately not a real
 * slug, so it can never be granted by accident.
 */
export const ANY_TIMING_PERMISSION = 'timing.*';

export interface TimingSurface {
  /** The slug this address demands, or {@link ANY_TIMING_PERMISSION}. */
  permission: string;
  /** The event slug in the address, when it names one. */
  eventSlug: string | null;
  /** Whether holding the permission is sufficient, or a `timing.marshals` row is also owed. */
  rosterScoped: boolean;
}

/**
 * The second and later segments of an event address, mapped to what they demand.
 *
 * `/timing/events/<slug>/` itself is `timing.event.manage` — the row for the empty tail.
 */
const EVENT_SECTIONS: Record<string, string> = {
  '': 'timing.event.manage',
  registration: 'timing.registration.import',
  marshals: 'timing.marshal.assign',
  start: 'timing.event.manage',
  finish: 'timing.event.manage',
  status: 'timing.event.manage',
  'danger-zone': 'timing.event.manage',
  anomalies: 'timing.crossing.resolve',
  crossings: 'timing.crossing.resolve',
  results: 'timing.result.publish',
};

/** This application's own base path, as `next.config.ts` sets it. */
const BASE_PATH = '/timing';

/**
 * Path segments, with the base path removed if it is there and the trailing slash ignored.
 *
 * ⚠️ **Both spellings are accepted on purpose, and it is not defensiveness for its own sake.**
 * Next strips `basePath` from `nextUrl.pathname` before middleware sees it — which is why
 * `middleware.ts`'s own matcher is written as `'/'` rather than `'/timing'` — but that is an
 * undocumented interaction this repository has already been bitten by once, in the comment on
 * that matcher. **Getting it wrong here fails in whichever direction is worse**: if the prefix
 * is present and unhandled, every row below misses and the whole application 404s to its own
 * staff; if it is absent and stripped anyway, nothing changes. Accepting both costs one line
 * and removes the guess. `access.test.ts` asserts both spellings resolve identically.
 */
function segmentsOf(pathname: string): string[] {
  const withoutBase =
    pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`)
      ? pathname.slice(BASE_PATH.length)
      : pathname;

  return withoutBase.split('/').filter(Boolean);
}

/**
 * What this address demands, or `null` if nothing is written down for it.
 *
 * ⚠️ **`null` means refuse, and every caller must treat it that way.** An address nobody has
 * mapped is an address nobody has decided about, and the safe answer to that is the one this
 * whole surface already gives to strangers: the ordinary 404. Adding a page to `/timing` means
 * adding a row here, and forgetting to is a page that does not open rather than a page that
 * opens to anybody.
 */
export function surfaceFor(pathname: string): TimingSurface | null {
  const segments = segmentsOf(pathname);

  // `/timing/` — the landing page. It lists only what the viewer may open, so any timing
  // permission is enough to see it and the list is what differs.
  if (segments.length === 0) {
    return { permission: ANY_TIMING_PERMISSION, eventSlug: null, rosterScoped: false };
  }

  // `/timing/marshal/<slug>/` — the capture screen. The permission is not enough on its own.
  if (segments[0] === 'marshal') {
    if (segments.length !== 2) {
      return null;
    }

    return {
      permission: 'timing.crossing.record',
      eventSlug: segments[1] ?? null,
      rosterScoped: true,
    };
  }

  if (segments[0] !== 'events') {
    return null;
  }

  // `/timing/events/` — the list.
  if (segments.length === 1) {
    return { permission: 'timing.event.manage', eventSlug: null, rosterScoped: false };
  }

  // `/timing/events/<slug>/<section?>` and nothing deeper. A third segment would be an
  // address nobody has decided about, which `null` refuses.
  if (segments.length > 3) {
    return null;
  }

  const permission = EVENT_SECTIONS[segments[2] ?? ''];

  return permission === undefined
    ? null
    : { permission, eventSlug: segments[1] ?? null, rosterScoped: false };
}

/**
 * Whether these permissions satisfy that surface — the permission half only.
 *
 * **The roster half is deliberately not here.** A function called `holdsPermissionFor` that
 * silently also answered a roster question would be the thing that hides an unimplemented
 * check; `TimingSurface.rosterScoped` makes the caller say out loud what it is doing about it.
 */
export function holdsPermissionFor(
  permissions: readonly string[],
  surface: TimingSurface,
): boolean {
  if (surface.permission === ANY_TIMING_PERMISSION) {
    return permissions.some((p) => p.startsWith('timing.'));
  }

  return permissions.includes(surface.permission);
}

/**
 * Whether this viewer may open this address, on the permission check alone.
 *
 * The one function a page's navigation should ask, so a link and the door behind it cannot
 * disagree — `apps/main`'s admin shell paints its nav from the same `permissions` array for
 * exactly this reason, and the old timing app's marshal nav carried a "Start" tab that 403'd
 * every marshal who tapped it.
 */
export function canOpen(permissions: readonly string[], pathname: string): boolean {
  const surface = surfaceFor(pathname);
  return surface !== null && holdsPermissionFor(permissions, surface);
}
