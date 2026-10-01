import type { ReactNode } from 'react';
import { timingHref } from '../../lib/chrome';
import { ClubFooter, ClubHeader, ClubSkipLink } from './club-chrome';

/**
 * The read-free half of the frames: the section bar, the breadcrumbs and `ClubFrame`.
 *
 * **Its own module because `app/global-error.tsx` is a client component**, and the race frames
 * in `frames.tsx` read the person's permissions through `next/headers`, which a client bundle
 * cannot import. Everything here renders from props alone — which is also what lets the
 * not-found page stay prerendered.
 */

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The bar under the header that moves between the pages of one section — the markup
 * `apps/main/worker/club-chrome.ts`'s `sectionBar()` draws, styled by `club-chrome.css`.
 * Links rather than ARIA tabs, because each is a page with its own address.
 */
export function SectionBar({
  name,
  tabs,
}: {
  name: string;
  tabs: readonly { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav className="club-section" aria-label={name}>
      <div className="club-wrap club-section-inner">
        <p className="club-section-name">{name}</p>
        <ul>
          {tabs.map((tab) => (
            <li key={tab.href}>
              <a href={tab.href} aria-current={tab.current ? 'page' : undefined}>
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

const CHEVRON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * Where this page sits, as the first thing in `<main>`. The last crumb is the page being read:
 * `aria-current="page"` and not a link. A crumb with no `href` that is not last is a place the
 * reader cannot open — a race whose overview needs a permission they do not hold — and is named
 * without being linked, for the reason a tab is filtered rather than locked.
 */
export function Breadcrumbs({ trail }: { trail: readonly Crumb[] }) {
  return (
    <nav className="club-crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${index}-${crumb.label}`}>
              {index === 0 ? null : CHEVRON}
              {last ? (
                <span aria-current="page">{crumb.label}</span>
              ) : crumb.href === undefined ? (
                <span>{crumb.label}</span>
              ) : (
                <a href={crumb.href}>{crumb.label}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "Races and events › Race timing", the start of every trail here. */
export const TIMING_TRAIL: readonly Crumb[] = [
  { label: 'Races and events', href: '/events/' },
  { label: 'Race timing', href: timingHref('/') },
];

/**
 * The club header and footer around a page, and nothing else — the not-found page and the
 * error page. **No reads**, because the not-found page is prerendered: it is what a refusal at
 * the door is rewritten to (ADR-044), and it must not need a session to render.
 */
export function ClubFrame({
  bar,
  trail,
  children,
}: {
  bar?: ReactNode;
  trail?: readonly Crumb[];
  children: ReactNode;
}) {
  return (
    <>
      <ClubSkipLink />
      <ClubHeader />
      {bar}
      <main id="main">
        {trail === undefined ? null : <Breadcrumbs trail={trail} />}
        {children}
      </main>
      <ClubFooter />
    </>
  );
}
