import { NextResponse } from 'next/server';
import { readTiming } from '../../../../lib/reads';

/**
 * `GET /timing/marshal/<slug>/known` — what this race already has, for the two things the
 * capture screen cannot work out on its own.
 *
 * Issue [#203](https://github.com/southville-running-club/src-website/issues/203). Behind
 * `timing.crossing.record` **and** a roster row, like everything else under `/timing/marshal/`.
 *
 * ## The two jobs, and they are not the same job
 *
 * 1. **The reload reconcile.** A card left `syncing` when the page went away is one whose
 *    request was sent and whose answer was never seen. Reading the ids back says outright
 *    whether it landed: present, and the card is retired; absent, and it goes back in the
 *    queue for an idempotent retry. `queue-state.ts`'s `reconcile()` is that decision.
 * 2. **Cross-device duplicate detection.** `checkAnomaly()` needs the crossings *other* phones
 *    have recorded, or a bib captured twice at two points on the course looks new to both.
 *
 * ⚠️ **Which is why this is a read of the whole race and not of the ids this phone asks
 * about.** A `?ids=` form would do the first job and quietly break the second, and the
 * breakage would only ever show up as an anomaly that was not flagged — invisible on the day
 * and wrong afterwards.
 *
 * ## What it deliberately does not carry
 *
 * `known_crossings()` returns no marshal identity, by design: who recorded a crossing is for
 * an admin resolving an anomaly, behind a different permission, and it is not a fact this
 * screen needs in order to de-duplicate. This route passes through what the function gives and
 * adds nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  const read = await readTiming<unknown[]>('known_crossings', { p_event_slug: slug });

  if (read.state === 'unavailable') {
    // ⚠️ **503 and not an empty list.** An empty list is a claim — *"this race has had no
    // crossings"* — and a screen that believed it during an outage would retire every card it
    // was reconciling and flag no duplicate for the rest of the morning. 503 is what the
    // client already knows to retry.
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  // `none` is the refusal and the missing race, indistinguishable — the door should have
  // caught both, so reaching here means something changed between the two reads. An empty list
  // would be the same false claim as above, so it is the same answer.
  if (read.state === 'none') {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  return NextResponse.json(
    { crossings: read.data },
    // A cached answer here is a reconcile against a race as it was some minutes ago, which is
    // exactly the window a card can land in.
    { headers: { 'cache-control': 'no-store' } },
  );
}
