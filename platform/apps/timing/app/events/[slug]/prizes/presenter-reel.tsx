'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  brightness,
  explode,
  planBursts,
  step,
  type Spark,
} from '../../../../lib/fireworks';
import { withoutSpin, withSpin } from '../../../../lib/prize-reel';

/**
 * The presenter's reveal, the part that needs a script — `lib/prize-reel.ts` is the rest.
 *
 * ⚠️ **None of this is how the winner is shown.** The server renders the winner into the page
 * every time; the reels and the held caption are CSS on that markup. What a script adds is the
 * one-shot `spin` on the way to a reveal, taking it back out of the address, saying who won
 * once the reels land, and the fireworks. With scripting off, every link here is a plain link
 * and the winner is shown at once.
 */

/** Whether this browser is happy to be shown motion. Asked at the moment, never remembered. */
export function motionAllowed(): boolean {
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A link to a reveal that spins when it can: the plain address as its `href`, so it works with
 * scripting off, a middle-click or a new tab, and the address with `spin` added when an ordinary
 * click lands on it in a browser that is happy with motion.
 */
export function SpinLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!motionAllowed()) return;
        event.preventDefault();
        window.location.assign(withSpin(href));
      }}
    >
      {children}
    </a>
  );
}

/**
 * Mounted on a revealed prize that is spinning: takes `spin` out of the address at once, waits
 * for the reels and the caption to finish, then says who won — once — and lets the fireworks go.
 *
 * ⚠️ **It waits on the animations themselves rather than on a timer.** The CSS starts at the
 * page's first paint and this runs after hydration, which can be half a second later on a slow
 * laptop, so a timer started here would set the fireworks off after the name rather than with
 * it. Animations that have already finished, or never ran because the browser asks for less
 * motion, resolve at once.
 */
export function ReelLanding({ announcement }: { announcement: string }) {
  const [landed, setLanded] = useState(false);
  const [fireworks, setFireworks] = useState(false);
  const fireworksDone = useCallback(() => setFireworks(false), []);

  useEffect(() => {
    // A refresh from here on should show the winner, not spin again.
    window.history.replaceState(
      window.history.state,
      '',
      withoutSpin(window.location.href),
    );

    let cancelled = false;
    const reveal = document.querySelector('[data-reel-reveal]');
    const running =
      reveal === null || typeof document.getAnimations !== 'function'
        ? []
        : document.getAnimations().filter((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return target instanceof Element && reveal.contains(target);
          });

    Promise.all(running.map((animation) => animation.finished))
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setLanded(true);
        setFireworks(motionAllowed());
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {/* ⚠️ Empty in the server's markup and filled once, so it is announced once — the reels
          are hidden from assistive technology, which would otherwise hear every digit. */}
      <p className="timing-visually-hidden" role="status" data-reel-announce="">
        {landed ? announcement : ''}
      </p>
      {fireworks ? <Fireworks onDone={fireworksDone} /> : null}
    </>
  );
}

/** The colours the fireworks are drawn in: the club's, read off the page rather than restated. */
function paletteOf(element: Element): string[] {
  const style = getComputedStyle(element);
  return [
    style.getPropertyValue('--club-brand').trim(),
    style.getPropertyValue('--club-highlight').trim(),
    style.color,
  ].filter((colour) => colour !== '');
}

/**
 * A canvas over the whole screen for a few seconds. Hidden from assistive technology, takes no
 * pointer events, and removes itself when the last spark is out. `lib/fireworks.ts` decides
 * everything; this only draws.
 */
function Fireworks({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas === null || context === null || context === undefined) {
      onDone();
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);

    const pending = planBursts(width, height, paletteOf(canvas), Math.random);
    const scale = Math.min(width, height);
    let sparks: Spark[] = [];
    let started: number | null = null;
    let last = 0;
    let frame = 0;

    const draw = (now: number) => {
      started ??= now;
      const elapsed = now - started;
      const dt = Math.min(now - (last || now), 50);
      last = now;

      while (pending.length > 0 && pending[0]!.atMs <= elapsed) {
        sparks = sparks.concat(explode(pending.shift()!, scale, Math.random));
      }
      sparks = step(sparks, dt);

      // Fade what is already drawn rather than wiping it, which leaves each spark a short tail.
      context.globalCompositeOperation = 'destination-out';
      context.globalAlpha = 0.25;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';
      for (const spark of sparks) {
        context.globalAlpha = brightness(spark);
        context.fillStyle = spark.colour;
        context.beginPath();
        context.arc(spark.x, spark.y, 2.5, 0, Math.PI * 2);
        context.fill();
      }

      if (pending.length === 0 && sparks.length === 0) {
        onDone();
        return;
      }
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [onDone]);

  return (
    <canvas
      ref={canvasRef}
      className="timing-fireworks"
      aria-hidden="true"
      data-presenter-fireworks=""
    />
  );
}
