/**
 * What `timing.event_detail()` answers, as the console's sections read it.
 *
 * ⚠️ **One declaration, because three sections used to carry their own.** `start`, `finish` and
 * the hub each declared this shape independently while they were separate pages, which was
 * harmless when a change to the function broke three files at once and told you so. On one page
 * it stops being harmless: two sections disagreeing about the shape of one read is a bug the
 * compiler cannot see, because both would be structurally valid against the same `any`-shaped
 * RPC result.
 *
 * `readTiming()` casts its answer rather than validating it, so this type is a claim about the
 * database rather than a guarantee from it — the guarantee is
 * `packages/db/tests/timing.test.ts`, which pins the function's grant, and the generated
 * `database.types.ts`, which pins its signature.
 *
 * [#308](https://github.com/southville-running-club/src-website/issues/308).
 */
export interface EventDetail {
  slug: string;
  name: string;
  start_at: string;
  actually_started_at: string | null;
  finished_at: string | null;
  counts: { crossings: number; open_anomalies: number };
}
