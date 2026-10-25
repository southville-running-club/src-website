import type { CSSProperties } from 'react';
import type { EventFormat } from '@src/shared/timing/bib';
import type { TimingRunner } from '@src/shared/timing/rows';
import type { PrizeAward } from '@src/shared/timing/prize-export';
import { drawablePool, type PrizeChoices } from '../../../../lib/prizes';
import {
  buildReels,
  FACE_DOWN,
  landingAnnouncement,
  reelNumberFor,
  spinMs,
  type Reel,
} from '../../../../lib/prize-reel';
import { PresenterKeys } from './presenter-keys';
import { ReelLanding, SpinLink } from './presenter-reel';

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
 *
 * ## The reveal is a slot machine, and the winner is never the script's to choose
 *
 * The face-down card is a row of reels, one per digit of the winner's race number. **Reveal**
 * spins them through 0–9, slowing until they land left to right on that number, and then the
 * name, the time and fireworks — Pass the Buck's own reveal. `lib/prize-reel.ts` argues why a
 * reel shows digits and never anybody's name, and `presenter-reel.tsx` is the script half.
 *
 * ⚠️ **The winner is in this markup every time, and only CSS holds it back.** A spinning reveal
 * renders exactly what a plain one does, plus a strip of digits on each reel and an animation
 * delay on the caption, so there is nothing for a script to get wrong about who won — and with
 * scripting off, or a browser that asks for less motion, the caption is simply shown. A judged
 * prize, and a prize with nobody eligible, have no reels and never spin.
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

/**
 * The reels, decorative and hidden from assistive technology — the number they show is written
 * out as text beside the name, and `ReelLanding` says it once when they land.
 */
function Reels({
  reels,
  mode,
}: {
  reels: readonly Reel[];
  mode: 'face-down' | 'landed' | 'spinning';
}) {
  return (
    <div
      className="timing-reels"
      aria-hidden="true"
      data-reel-spin={mode === 'spinning' ? '' : undefined}
    >
      {reels.map((reel, index) => (
        <span key={index} className={`timing-reel timing-reel-${mode}`}>
          {mode === 'spinning' ? (
            <span
              className="timing-reel-strip"
              style={
                {
                  '--reel-stop': reel.strip.length - 1,
                  '--reel-ms': `${reel.stopMs}ms`,
                } as CSSProperties
              }
            >
              {reel.strip.map((cell, at) => (
                <span key={at}>{cell}</span>
              ))}
            </span>
          ) : (
            <span className="timing-reel-strip">
              <span>{mode === 'face-down' ? FACE_DOWN : reel.target}</span>
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function Presenter({
  slug,
  raceName,
  format,
  awards,
  choices,
  prize,
  reveal,
  spin = false,
}: {
  slug: string;
  raceName: string;
  format: EventFormat;
  awards: readonly PrizeAward[];
  choices: PrizeChoices;
  /** 1-based; one past the end is "All prizes awarded". */
  prize: number;
  reveal: boolean;
  /** `?spin=1` — the one-shot reveal only the presenter's script asks for. */
  spin?: boolean;
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
  let revealSpins = false;

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
          <>
            <Reels
              reels={buildReels(
                reelNumberFor(
                  { type: 'team', team: offer, metricMs: 0, metricLabel: '' },
                  format,
                )?.value ?? FACE_DOWN,
              )}
              mode="face-down"
            />
            <p>
              {/* The draw is taken on the server, into the address — `lib/prizes.ts`. The spin
                  only plays the reels to the number it already names. */}
              <SpinLink
                className="club-btn timing-presenter-primary"
                href={presenterHref(
                  slug,
                  choices,
                  { prize, reveal: true },
                  { draw: { kind: award.kind, team: offer.id } },
                )}
              >
                Roll the bib
              </SpinLink>
            </p>
          </>
        );
    } else {
      const number = reelNumberFor(winner, format);
      const reels = number === null ? [] : buildReels(number.value);
      const name =
        winner.type === 'runner' ? nameOf(winner.runner) : teamNames(winner.team.runners);

      if (!reveal) {
        revealHref = at(prize, true);
        revealSpins = number !== null;
        stage = (
          <>
            <Reels
              reels={number === null ? buildReels(FACE_DOWN) : reels}
              mode="face-down"
            />
            <p>
              {revealSpins ? (
                <SpinLink className="club-btn timing-presenter-primary" href={revealHref}>
                  Reveal
                </SpinLink>
              ) : (
                <a className="club-btn timing-presenter-primary" href={revealHref}>
                  Reveal
                </a>
              )}
            </p>
          </>
        );
      } else {
        const spinning = spin && reels.length > 0;
        stage = (
          <>
            {reels.length === 0 ? null : (
              <Reels reels={reels} mode={spinning ? 'spinning' : 'landed'} />
            )}
            <div
              className={
                spinning
                  ? 'timing-presenter-reveal timing-presenter-held'
                  : 'timing-presenter-reveal'
              }
              data-reel-reveal={spinning ? '' : undefined}
              style={
                spinning
                  ? ({ '--reel-total-ms': `${spinMs(reels)}ms` } as CSSProperties)
                  : undefined
              }
            >
              <p className="timing-presenter-winner">{name}</p>
              {number === null ? null : (
                <p className="timing-presenter-number timing-mono">
                  {number.label} {number.value}
                </p>
              )}
              {winner.metricLabel === '' ? null : (
                <p className="timing-presenter-time timing-mono">{winner.metricLabel}</p>
              )}
              <p>
                {/* ⚠️ "Not here" excludes them from **every** prize, as on the list — and spins
                    to whoever is next, as Pass the Buck re-rolled. */}
                <SpinLink
                  className="club-btn timing-presenter-outline"
                  href={presenterHref(
                    slug,
                    choices,
                    { prize, reveal: true },
                    { pass: winner.team.id },
                  )}
                >
                  Not here &mdash; pass to the next
                </SpinLink>
              </p>
            </div>
            {spinning ? (
              <ReelLanding
                announcement={landingAnnouncement(name, number, winner.metricLabel)}
              />
            ) : null}
          </>
        );
      }
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
      <PresenterKeys prev={prev} next={next} reveal={revealHref} spin={revealSpins} />
    </div>
  );
}
