// The club's wordmark, as inline `<svg>`.
//
// **The opposite number of `apps/main/src/components/ClubLogo.astro`.** Two frameworks, one
// set of numbers: both import `CLUB_LOGO` from `@src/shared/brand`, so the artwork cannot
// differ between the club's front door and this one. Only the tags are duplicated, and that
// duplication is the honest price of Astro on one side of the hostname and Next on the other.
//
// Inline rather than `<img src="/logo.svg">` because an SVG referenced by `<img>` is a
// separate document: `currentColor` inside it resolves against nothing and falls back to
// black, so an `<img>` can only ever be the colour it was saved as. Inline, the paths inherit
// from CSS — see `.site-banner-mark` in `packages/shared/styles/base.css`.
import { CLUB_LOGO } from '@src/shared/brand';

export function ClubLogo({
  width = 176,
  className,
  labelled = true,
}: {
  /** Rendered width in CSS pixels. The height follows from the artwork's aspect ratio. */
  width?: number;
  className?: string;
  /**
   * Whether the mark carries its own accessible name. `false` where an ancestor already
   * names it, so a screen reader does not read "Southville Running Club" twice in a row.
   */
  labelled?: boolean;
}) {
  const [, , vbWidth, vbHeight] = CLUB_LOGO.viewBox.split(' ').map(Number);
  const height = Math.round((width * vbHeight) / vbWidth);

  return (
    <svg
      className={className}
      viewBox={CLUB_LOGO.viewBox}
      width={width}
      height={height}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? CLUB_LOGO.title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* `fill="currentColor"` on every path, and no fill anywhere else. `fillRule` is
          carried over from the trace — without it the R's bowl (a counter-wound subpath
          within its own `d`) fills in solid instead of leaving a hole. */}
      {CLUB_LOGO.paths.map((p, i) => (
        <path key={i} d={p.d} fill="currentColor" fillRule="nonzero" />
      ))}
    </svg>
  );
}
