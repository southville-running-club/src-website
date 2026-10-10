import type { TimingRunner } from '@src/shared/timing/rows';
import type { PrizeAward } from '@src/shared/timing/prize-export';
import { drawablePool, type PrizeChoices } from '../../../../lib/prizes';
import { PresenterKeys } from './presenter-keys';

/**
 * **Presenter mode** — Pass the Buck's prize-giving screen (ADR-055), for a laptop on a projector
 * at HQ: one prize at a time on a dark screen, the winner face down until **Reveal**, and ← / →
 * between prizes.
 *
 * ⚠️ **Everything is in the address, as the list's is** — which prize is showing, whether it has
 * been revealed, every pass-over and every draw — so a refresh mid-ceremony loses nothing, the
 * back button undoes the wrong tap, and it works with scripting off. The keys are a convenience
 * over links that are already there (`presenter-keys.tsx`).
 *
 * Nightingale Nightmare's fancy dress is **judged on the day**, so it has no winner to reveal:
 * the screen says so, and whoever is holding the microphone announces it.
 */

function nameOf(runner: TimingRunner): string {
  return `${runner.firstname} ${runner.lastname}`.trim();
}

function teamNames(runners: readonly TimingRunner[]): string {
  return runners
    .filter((runner) => runner.role !== 'guide')
    .map(nameOf)
    .filter((name) => name !== '')
    .join(' & ');
}

/** This prize page's address with the presenter's place, every choice made, and a change. */
export function presenterHref(
  slug: string,
  choices: PrizeChoices,
  place: { prize: number; reveal?: boolean },
  extra: { pass?: string; draw?: { kind: string; team: string } } = {},
): string {
  const params = new URLSearchParams();
  params.set('present', '1');
  params.set('prize', String(place.prize));
  if (place.reveal === true) params.set('reveal', '1');
  for (const id of choices.passed) params.append('pass', id);
  if (extra.pass !== undefined) params.append('pass', extra.pass);
  for (const [kind, id] of choices.draws) params.set(kind, id);
  if (extra.draw !== undefined) params.set(extra.draw.kind, extra.draw.team);
  return `/timing/events/${encodeURIComponent(slug)}/prizes?${params.toString()}`;
}

export function Presenter({
  slug,
  raceName,
  awards,
  choices,
  prize,
  reveal,
}: {
  slug: string;
  raceName: string;
  awards: readonly PrizeAward[];
  choices: PrizeChoices;
  /** 1-based; one past the end is "All prizes awarded". */
  prize: number;
  reveal: boolean;
}) {
  const total = awards.length;
  const listHref = `/timing/events/${encodeURIComponent(slug)}/prizes`;
  const at = (n: number, revealed = false) =>
    presenterHref(slug, choices, { prize: n, reveal: revealed });
  const prev = prize > 1 ? at(prize - 1) : null;
  const next = prize <= total ? at(prize + 1) : null;
  const award = awards[prize - 1];

  let body;
  let revealHref: string | null = null;

  if (award === undefined) {
    body = (
      <div className="timing-presenter-centre">
        <h1>All prizes awarded.</h1>
        <p className="timing-presenter-rule">Thank you, everybody.</p>
        <p>
          <a className="club-btn timing-presenter-primary" href={listHref}>
            Back to the prize list
          </a>
        </p>
      </div>
    );
  } else {
    const winner = award.winner;
    const pool = drawablePool(award, choices);
    const offer =
      pool.length === 0 ? undefined : pool[Math.floor(Math.random() * pool.length)];

    let stage;
    if (award.judged === true) {
      stage = (
        <p className="timing-presenter-big">
          Judged on the day &mdash; announce the winners.
        </p>
      );
    } else if (winner === null) {
      stage =
        offer === undefined ? (
          <>
            <p className="timing-presenter-big">No eligible winner yet.</p>
            <p className="timing-presenter-rule">
              Nobody in this category has finished yet, or everybody who has is already
              holding a prize.
            </p>
          </>
        ) : (
          <p>
            <a
              className="club-btn timing-presenter-primary"
              href={presenterHref(
                slug,
                choices,
                { prize, reveal: true },
                { draw: { kind: award.kind, team: offer.id } },
              )}
            >
              Roll the bib
            </a>
          </p>
        );
    } else if (!reveal) {
      revealHref = at(prize, true);
      stage = (
        <>
          <div className="timing-presenter-card" aria-hidden="true">
            ?
          </div>
          <p>
            <a className="club-btn timing-presenter-primary" href={revealHref}>
              Reveal
            </a>
          </p>
        </>
      );
    } else {
      stage = (
        <>
          <p className="timing-presenter-winner">
            {winner.type === 'runner'
              ? nameOf(winner.runner)
              : teamNames(winner.team.runners)}
          </p>
          {winner.metricLabel === '' ? null : (
            <p className="timing-presenter-time timing-mono">{winner.metricLabel}</p>
          )}
          <p>
            {/* ⚠️ "Not here" excludes them from **every** prize, as on the list. */}
            <a
              className="club-btn timing-presenter-outline"
              href={presenterHref(
                slug,
                choices,
                { prize, reveal: true },
                { pass: winner.team.id },
              )}
            >
              Not here &mdash; pass to the next
            </a>
          </p>
        </>
      );
    }

    body = (
      <div className="timing-presenter-centre">
        <h1>{award.title}</h1>
        <p className="timing-presenter-rule">{award.subtitle}</p>
        {stage}
      </div>
    );
  }

  return (
    <div className="timing-presenter">
      <div className="club-wrap timing-presenter-bar">
        <p className="timing-hub-eyebrow">{raceName} · Prize giving</p>
        <p className="timing-mono">
          {award === undefined ? 'Done' : `Prize ${prize} of ${total}`}
        </p>
        <nav aria-label="Prizes" className="timing-presenter-steps">
          {prev === null ? null : (
            <a className="club-btn timing-presenter-outline" href={prev}>
              <span aria-hidden="true">← </span>Previous
            </a>
          )}
          {next === null ? null : (
            <a className="club-btn timing-presenter-outline" href={next}>
              Next<span aria-hidden="true"> →</span>
            </a>
          )}
          <a className="timing-presenter-leave" href={listHref}>
            Leave presenter
          </a>
        </nav>
      </div>
      <div className="club-wrap">{body}</div>
      <PresenterKeys prev={prev} next={next} reveal={revealHref} />
    </div>
  );
}
