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
 * module says *that a roster check is owed* and does not perform one.
 *
 * ⚠️ **[#245](https://github.com/southville-running-club/src-website/issues/245) did not close
 * this, and it is worth saying why rather than leaving the comment to rot.** It built the four
 * functions the *roster page* needs, and every one of them is behind `timing.marshal.assign` —
 * an admin's permission. The question this flag is about is a different one asked by a
 * different person: *"am I, a marshal holding only `timing.crossing.record`, on this event's
 * roster?"*.
 *
 * **[#203](https://github.com/southville-running-club/src-website/issues/203) is what answers
 * it**, with `timing.marshal_event()` — the same two checks `record_crossing()` makes, in the
 * same order, returning the race a marshal may see or `null` for all three refusals. So
 * `rosterScoped` is now a flag `middleware.ts` acts on rather than one it refuses on, and this
 * module still performs no roster check: it says *that a roster check is owed*, and the door
 * is the one place that makes it.
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

/**
 * The **fourth** segment: an address a form posts to, mapped by the section it belongs to.
 *
 * ## Why a write needs an address of its own here at all
 *
 * ⚠️ **A page in the App Router answers `GET` and nothing else.** `page.tsx` and `route.ts`
 * cannot both sit on one segment, so a write is either a Server Action posting back to the
 * page's own address or a route handler on an address of its own. **This application takes the
 * second, and the reason is the `no-javascript` Playwright project rather than taste**: a
 * plain `<form method="post">` to a route handler is HTML that cannot fail with scripting off,
 * which is the property every other write on this platform already has —
 * `apps/main/worker/admin.ts` is nothing but POST handlers answering 303. A Server Action's
 * no-script fallback is a real Next feature and would probably work; *probably* is not a thing
 * to find out about on a start line, and this repository's rule is to measure rather than
 * assume. Revisit it the day something here needs a partial update rather than a whole page.
 *
 * ## The property this table must not lose
 *
 * A write address is refused by omission, exactly as a page is. `marshals/update` is written
 * down; `marshals/anything-else` is not, and `surfaceFor` answers `null` for it, which every
 * caller treats as refuse. **The permission is the section's own** — being allowed to read a
 * roster and being allowed to change one are the same `timing.marshal.assign`, and the day
 * they stop being the same this table is where that is said.
 */
const EVENT_SECTION_ACTIONS: Record<string, Record<string, string>> = {
  marshals: { update: 'timing.marshal.assign' },
  // #250. One address for both presses — starting a race and clearing a false start are the
  // same `timing.event.manage` and the same screen, and the `intent` field is what says which.
  start: { update: 'timing.event.manage' },
  /**
   * The entry list's two write addresses — [#202](https://github.com/southville-running-club/src-website/issues/202).
   *
   * **`import` is separate from `update` because it is the only `multipart/form-data` post on
   * this platform**, and the two want different bodies rather than different permissions:
   * `import` reads a file, `update` reads five fields. Both demand
   * `timing.registration.import`, which is the section's own — being allowed to read a roster
   * and being allowed to change one are the same permission here, and the day they stop being
   * the same this table is where that is said.
   *
   * `update` carries four intents — assigning bibs, overriding one, adding a walk-in and
   * importing from `entries` — for `marshals/update`'s reason: an intent nobody wrote down
   * falls through to a refusal, and a fourth address would be a fourth row to keep in step.
   */
  registration: {
    import: 'timing.registration.import',
    update: 'timing.registration.import',
  },
  /**
   * The two surfaces where a human turns a flagged capture into a fact —
   * [#252](https://github.com/southville-running-club/src-website/issues/252).
   *
   * Both demand `timing.crossing.resolve`, the section's own. ⚠️ **They are two addresses
   * rather than one because they are two different compare-and-swaps**, not because the
   * permission differs: the anomalies page latches on `resolved_at is null`, and the log
   * cannot — a row that was never flagged has `resolved_at` null for ever, so it swaps on the
   * values that were on screen instead. `20260913220000`'s header carries the argument. One
   * address taking both would be one route handler branching on which latch it meant.
   */
  anomalies: { update: 'timing.crossing.resolve' },
  crossings: { update: 'timing.crossing.resolve' },
};

/**
 * The **third** segment under `/timing/marshal/<slug>/` — the two addresses the capture screen
 * itself calls, rather than pages anybody navigates to.
 *
 * ⚠️ **These are `fetch` targets and they are gated by exactly the same table a page is**,
 * which is the property worth stating out loud: the screen is the only client, but the address
 * is on the public internet and an address nobody has written a row for is refused. Both
 * demand the capture permission and both are `rosterScoped`, so the door makes the same two
 * checks `record_crossing()` and `known_crossings()` make for themselves — three statements of
 * one rule is one too many, and `packages/db/tests/timing.test.ts` holds the one that counts.
 *
 * `sync` is the drain: a POST of queued crossings. `known` is the reload reconcile: a GET of
 * what this race already has, so a card that landed before the response was lost is retired
 * rather than retried for ever.
 */
const MARSHAL_ACTIONS: Record<string, string> = {
  sync: 'timing.crossing.record',
  known: 'timing.crossing.record',
};

/** This application's own base path, as `next.config.ts` sets it. */
const BASE_PATH = '/timing';

/**
 * One row out of one of the tables above — **and never a property it merely inherited**.
 *
 * ⚠️ **A bare `TABLE[key]` is not a lookup, and this was a real defect rather than a
 * precaution.** An object literal inherits from `Object.prototype`, so
 * `EVENT_SECTIONS['constructor']` is a *function* and `EVENT_SECTIONS['toString']` is another
 * — both truthy, neither `undefined`. `surfaceFor('/events/nn-2026/constructor')` therefore
 * answered a surface whose `permission` was a function, instead of the `null` this module's
 * own header promises for "an address nobody has written a rule for".
 *
 * **It did not open a door, and that was luck rather than design.** `holdsPermissionFor` asks
 * `permissions.includes(...)`, and no array of permission slugs contains a function, so the
 * request was refused one step further on. But `middleware.ts` refuses on `surfaceFor(...)
 * === null` *before* it reads a session at all, and the whole argument for this table is that
 * a missing row refuses by itself. A property that holds only because the next function
 * happens to disagree with it is not the property that was written down.
 *
 * `Object.hasOwn` is the fix, in one place, so the three tables cannot answer differently.
 */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

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

  // `/timing/marshal/<slug>/` and the two addresses its screen talks to. The permission is
  // never enough on its own here — every one of them is `rosterScoped`.
  if (segments[0] === 'marshal') {
    if (segments.length === 1 || segments.length > 3) {
      return null;
    }

    // A third segment is the screen's own address, looked up the way an event section's
    // actions are: a spelling nobody wrote down is refused rather than opened.
    const permission =
      segments.length === 3
        ? lookup(MARSHAL_ACTIONS, segments[2] ?? '')
        : 'timing.crossing.record';

    if (permission === undefined) {
      return null;
    }

    return {
      permission,
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

  // `/timing/events/<slug>/<section?>/<action?>` and nothing deeper. A fifth segment is an
  // address nobody has decided about, which `null` refuses.
  if (segments.length > 4) {
    return null;
  }

  // A form's target — `.../marshals/update` — rather than a page. See EVENT_SECTION_ACTIONS.
  const section = segments[2] ?? '';

  // A fourth segment is a form's target and is looked up in its section's own table; a section
  // with no actions at all — every one of them but `marshals` today — answers `undefined` for
  // every spelling under it, which is the refusal.
  const actions = lookup(EVENT_SECTION_ACTIONS, section) ?? {};
  const permission =
    segments.length === 4
      ? lookup(actions, segments[3] ?? '')
      : lookup(EVENT_SECTIONS, section);

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
