/**
 * The club website's content files, and the schemas that refuse a malformed one.
 *
 * ## Why the club's own facts live in JSON rather than in markup
 *
 * This is `race.json`'s pattern, applied to the club rather than to a race: anything that
 * changes over time is data, so changing it is an edit to one file that a volunteer can read,
 * rather than a hunt through six templates for the four places a meeting time is written out.
 *
 * It is also the only arrangement in which "never ship a placeholder" can be enforced. A fact
 * the club has not supplied is an **absent key**, and an absent key renders "to be confirmed"
 * or renders nothing — which is a behaviour a unit test can assert. A fact written into a
 * template can only be checked by reading the template.
 *
 * ## ⚠️ Why the schemas are here and the data is in `apps/main/src/content/`
 *
 * `zod` is a dependency of this package and not of `apps/main`, so a schema in the app would
 * be resolving `zod` by hoisting rather than by declaration — which works until somebody
 * installs with a flat-node_modules setting and then does not. `nn-entry.ts` is the precedent:
 * the schema lives here and the thing it validates lives in the app.
 *
 * ## The site is static, so validation happens at build time
 *
 * Nothing here runs in a browser or in the Worker. A club page imports its JSON, parses it
 * through the schema in its frontmatter, and Astro does that once when `dist/` is built. **A
 * content change therefore needs a rebuild to appear**, which `apps/main/README.md` says in as
 * many words — it is the same property that makes the build the place a malformed file is
 * caught, rather than a visitor's browser.
 *
 * ## This file grows with the site
 *
 * It ships with `clubSchema` alone, which is what the footer needs. The events, links,
 * newsletters, partners, committee, membership and pace schemas join it with the pages that
 * render them, so that no schema is ever here without a caller.
 */
import { z } from 'zod';

/**
 * Where and when the club meets, and who it legally is.
 *
 * Read by the footer on every club page, and by the home page's facts strip when that lands.
 *
 * **The meeting details are one object rather than six loose keys** because they are always
 * rendered together and always change together: the club moved night once and would move
 * venue as one decision, not as four.
 */
export const clubSchema = z.object({
  /**
   * The registered company name, for the foot of every page.
   *
   * ⚠️ **Not the same string as `race.json`'s `privacy.controller`**, which is "Southville
   * Running Club Ltd" — the form the committee's own privacy notice uses. This is the form
   * the club's published website uses. Both are the same company and neither may be
   * "corrected" into the other: one is a legal notice's wording and one is the site's.
   */
  legalName: z.string().min(1),

  /** The affiliation line beneath it. */
  affiliation: z.string().min(1),

  meet: z.object({
    /** "Tuesdays and Thursdays". */
    days: z.string().min(1),
    /** "Meet 6.00pm, run 6.15pm" — one string, because it is read as one phrase. */
    time: z.string().min(1),
    /**
     * The venue's name alone — "Southbank Club".
     *
     * ⚠️ **Split from the street deliberately.** These were one combined string, which reads
     * correctly in an address block and clumsily in a sentence: the home page's steps came
     * out as *"Arrive by 6.10pm at the Southbank Club, Dean Lane."* Prose wants the name; an
     * address wants both, and composes them.
     */
    venue: z.string().min(1),
    /** "Dean Lane". Joined to `venue` wherever an address is printed. */
    street: z.string().min(1),
    city: z.string().min(1),
    postcode: z.string().min(1),
    /**
     * Where "Open in maps" goes.
     *
     * A full URL rather than a postcode the page turns into one, so that changing map
     * provider — or pointing at a pin the club has placed itself — is an edit to this file
     * and not to a template.
     */
    mapUrl: z.string().url(),
  }),

  /** Who the club is for, for the home page's facts strip. */
  who: z.string().min(1),
});

export type Club = z.infer<typeof clubSchema>;

/**
 * Parse `club.json`, or throw with the path to what is wrong.
 *
 * **Throwing is right here and would be wrong at a form.** This runs at build time against a
 * file in this repository, so the only way to reach the failure is to have committed a
 * malformed one — and failing the build is how that gets noticed before it is deployed. The
 * entry form's parser hands back errors to render beside a field because its input comes from
 * a person; this input comes from a diff.
 */
export function parseClub(value: unknown): Club {
  return clubSchema.parse(value);
}

/* -----------------------------------------------------------------------------------------
 * Links
 * -----------------------------------------------------------------------------------------
 * Every address on the club's pages that points somewhere the new site has not reached yet.
 */

/**
 * Where an action currently lives.
 *
 * **This is what makes moving one a data change rather than a search.** Components render the
 * "on our old site" label from `where`, so when a sign-up page is rebuilt here, changing
 * `href` and `where` on one entry updates every page that offers the action, label included.
 */
export const linkWhereSchema = z.enum(['old-site', 'new-site']);

export const linkSchema = z.object({
  href: z.string().min(1),
  where: linkWhereSchema,
  /** What the link says. Kept beside the address so the two cannot drift. */
  label: z.string().min(1),
});

/**
 * The stable keys. **Adding one is a deliberate act**, which is the point of listing them
 * rather than accepting any string: a typo in a page would otherwise render a dead link and
 * nothing would say so.
 *
 * ⚠️ **There is no `kit-order`.** Club kit is out of scope for this build — no kit section, no
 * order window, no stock, no collection point — and it comes back as its own piece of work.
 */
export const linksSchema = z.object({
  'pay-per-run': linkSchema,
  subscribe: linkSchema,
  join: linkSchema,
  renew: linkSchema,
  cancel: linkSchema,
  whatsapp: linkSchema,
  ptb: linkSchema,
  'ptb-results-2025': linkSchema,
  'ptb-results-2026': linkSchema,
  committee: linkSchema,
  'club-documents': linkSchema,
  newsletters: linkSchema,
});

export type Links = z.infer<typeof linksSchema>;
export type LinkKey = keyof Links;

export function parseLinks(value: unknown): Links {
  return linksSchema.parse(value);
}

/* -----------------------------------------------------------------------------------------
 * The pace guide
 * ----------------------------------------------------------------------------------------- */

/**
 * One row of the pace table: a group, and the times that put somebody in it.
 *
 * Times are strings rather than numbers because they are **published figures**, not values
 * anything computes with — "< 1:31" and "Sub 4:21" are what the club says, and parsing them
 * into minutes to re-render them would be a second chance to get them wrong.
 *
 * `fiveKMinutes` is the exception and exists for one reason: the "Find my group" picker
 * compares a typed 5K time against it. It is the upper bound of the band, in minutes.
 */
export const paceRowSchema = z.object({
  /** "Sub 9:00" — the group as the club names it. */
  group: z.string().min(1),
  perKm: z.string().min(1),
  fiveK: z.string().min(1),
  halfMarathon: z.string().min(1),
  marathon: z.string().min(1),
  /** The upper bound of this band's 5K time, in minutes. Read only by the picker. */
  fiveKMinutes: z.number().positive(),
});

export const paceSchema = z.object({
  rows: z.array(paceRowSchema).min(1),
  /** The groups that are not a pace band, said in the club's own words beneath the table. */
  alsoRunning: z.string().min(1),
});

export type Pace = z.infer<typeof paceSchema>;

export function parsePace(value: unknown): Pace {
  return paceSchema.parse(value);
}

/* -----------------------------------------------------------------------------------------
 * Membership
 * ----------------------------------------------------------------------------------------- */

/**
 * What each option costs, in pence, and what it is called.
 *
 * ## ⚠️ Two of the four prices are deliberately not here
 *
 * **Annual membership and the England Athletics option live in `membership.membership_types`
 * and in no file in this repository.** The club raises its fees about once a year and asked
 * for that to be one `update` rather than a deploy —
 *
 * ```sql
 * update membership.membership_types set price_pence = 500 where code = 'club';
 * ```
 *
 * — so every page that quotes either reads it at request time, painted by
 * `worker/membership.ts`. A copy in this file would be a second source that agreed on the day
 * it was written and silently stopped agreeing the day somebody ran that statement, which is
 * exactly the failure `entries.fees` and `store.ticket_types` both exist to rule out.
 *
 * **What ships in the markup is `PRICE_TO_BE_CONFIRMED`**, and the Worker replaces it. A page
 * that cannot reach the database therefore says the price is confirmed on the form rather
 * than quoting a figure it cannot stand behind — the same failure direction `/events/<slug>/`
 * takes with a date.
 *
 * ## What is still here
 *
 * The two that are not membership at all: **paying for one run**, which is the Southbank
 * Club's hire cost, and **the unlimited-runs subscription**, which is not membership and is
 * not sold by the application form. Neither is in `membership_types`, so neither has anywhere
 * else to be, and both move by deploy today.
 *
 * Prices are pence so they go through `formatPriceWords()` — "50p", "£4", "£2.50" — and never
 * through a template writing its own `£`.
 */
/**
 * The England Athletics registration year, and the words the page says about it.
 *
 * ## ⚠️ Why the fee is not here and the dates are
 *
 * **Every figure about the licence is in `membership.membership_types`** — the £27, the £4 the
 * club keeps and the £23 England Athletics' own registration costs — and
 * `tests/worker/membership.test.ts` asserts that no built page contains any of the three. The
 * dates are different in kind: nothing in the database holds them, because nothing in the
 * database needs them. `membership.settings` has `ea_cutoff_month` and `ea_cutoff_day`, which
 * are what the *application form* validates a date of birth against — not the sentence a
 * reader is shown, and not the renewal deadline at all.
 *
 * So these four are facts with nowhere else to live, and they move every year.
 *
 * `year` is a label rather than two numbers because "2026/27" is what England Athletics
 * publishes and what a member will look for; deriving it from a start date would be this file
 * restating a convention it does not own.
 */
export const membershipLicenceSchema = z.object({
  /** "2026/27" — England Athletics' own name for the registration year. */
  year: z.string().min(1),
  /** "1 April". The day the registration year opens. */
  yearStarts: z.string().min(1),
  /** "31 March". The day it closes. */
  yearEnds: z.string().min(1),
  /** "30 June" — the deadline a lapsed registration has to be renewed by. */
  renewBy: z.string().min(1),

  /**
   * ⚠️ **Optional, and absent is the safe state, because the committee has not signed this
   * off.** Second-claim membership — for somebody already registered with another club — is
   * offered on the page as a sentence the club supplied, and whether the club wants to say it
   * at all is theirs to decide. An absent key publishes nothing, which is what "we have not
   * agreed that yet" should look like; a present one is published word for word.
   */
  secondClaim: z.string().min(1).optional(),
});

/**
 * One cell of the comparison table.
 *
 * `true` is a tick, `false` is a dash, and a string is text — "Unlimited", "50p each*". There
 * is deliberately no fourth kind: a cell holding `null`, `0` or `""` would render as a blank,
 * which reads as "we forgot" rather than as either answer, and is what
 * `club-content.test.ts` refuses by name.
 */
export const comparisonCellSchema = z.union([z.boolean(), z.string().min(1)]);

/**
 * The prices a cell may quote, by name.
 *
 * ⚠️ **This closed list is the whole reason cells carry a token rather than a figure.** The
 * table has to say "50p each" in three of its cells, and 50p lives in `payPerRunPence` — so a
 * cell written as the words would be a fourth place that price is stated, agreeing on the day
 * it was typed. `{perRun}` is substituted at render time from the one source.
 *
 * A token that is not on this list is **refused rather than left unsubstituted**, because an
 * unsubstituted `{perWeek}` reaching the page is a placeholder, and the rule here is that a
 * placeholder cannot ship.
 */
export const COMPARISON_TOKENS = ['perRun', 'perMonth'] as const;

export type ComparisonToken = (typeof COMPARISON_TOKENS)[number];

/** The rendered price for each token, in the club's own words — "50p", "£2.50". */
export type ComparisonPrices = Record<ComparisonToken, string>;

const TOKEN_PATTERN = /\{([^}]*)\}/gu;

function unknownTokens(text: string): readonly string[] {
  return [...text.matchAll(TOKEN_PATTERN)]
    .map((match) => match[1] ?? '')
    .filter((name) => !COMPARISON_TOKENS.includes(name as ComparisonToken));
}

/**
 * One benefit, and what each of the four options gives you of it.
 *
 * `cells` is exactly four and in the table's own column order — pay as you run, unlimited
 * runs, SRC membership, SRC + EA. **A length check rather than a tuple of four named keys**:
 * the table's columns are positional on the page, a row with three cells is a row that would
 * silently shift every cell after it one column left, and `.length(4)` is what a volunteer
 * editing this file gets told about.
 *
 * `note` is the one short line under the benefit's name. Optional, because most rows say
 * enough in their own title, and absent renders nothing rather than an empty line.
 */
export const comparisonRowSchema = z.object({
  benefit: z.string().min(1),
  note: z.string().min(1).optional(),
  cells: z.array(comparisonCellSchema).length(4),
});

/** A group of rows, under a heading of its own — "Club life", "Racing". */
export const comparisonGroupSchema = z.object({
  group: z.string().min(1),
  rows: z.array(comparisonRowSchema).min(1),
});

export const membershipSchema = z
  .object({
    payPerRunPence: z.number().int().nonnegative(),
    subscriptionPerMonthPence: z.number().int().nonnegative(),
    licence: membershipLicenceSchema,
    /**
     * The comparison table, in the order it is read.
     *
     * ⚠️ **Groups and rows are data so that the committee can add or drop a benefit without
     * touching markup**, which is the same argument `pace.json` makes for its rows. England
     * Athletics republishes its benefit list every year and the club does not control it, so
     * the alternative is a template edited annually by whoever is available.
     */
    comparison: z.array(comparisonGroupSchema).min(1),
  })
  // ⚠️ **`.strict()`, and it is the only schema in this file that is.** Zod drops an unknown
  // key silently, so without this a `membershipPerYearPence` added back to `membership.json`
  // would be accepted, ignored, and invisible — somebody would edit a price, see nothing
  // change on the page, and have no way to find out why. Refusing it names the problem.
  .strict()
  // Every token in every cell has to be one the page can actually substitute. Checked here
  // rather than at each cell so the message names the row a volunteer has to go and fix.
  .superRefine((value, ctx) => {
    for (const group of value.comparison) {
      for (const row of group.rows) {
        for (const cell of row.cells) {
          if (typeof cell !== 'string') continue;

          for (const name of unknownTokens(cell)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                `"${row.benefit}" quotes {${name}}, which is not one of ` +
                COMPARISON_TOKENS.map((token) => `{${token}}`).join(', '),
            });
          }
        }
      }
    }
  });

export type Membership = z.infer<typeof membershipSchema>;
export type MembershipLicence = z.infer<typeof membershipLicenceSchema>;
export type ComparisonGroup = z.infer<typeof comparisonGroupSchema>;
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;
export type ComparisonCell = z.infer<typeof comparisonCellSchema>;

export function parseMembership(value: unknown): Membership {
  return membershipSchema.parse(value);
}

/**
 * Substitute a cell's price tokens, so the table quotes one source rather than restating it.
 *
 * The schema has already refused any token that is not in `COMPARISON_TOKENS`, so every
 * `{name}` reaching here has a value — which is why this replaces rather than defaulting.
 * A token surviving to the page would be a placeholder, and the guard against that is the
 * refusal at parse time, not a fallback here.
 */
export function comparisonText(text: string, prices: ComparisonPrices): string {
  return text.replace(
    TOKEN_PATTERN,
    (whole, name: string) => prices[name as ComparisonToken] ?? whole,
  );
}

/* -----------------------------------------------------------------------------------------
 * Partners
 * ----------------------------------------------------------------------------------------- */

/**
 * A business that looks after members.
 *
 * ⚠️ **`offer` is optional and is absent for every partner today.** The offers have not been
 * confirmed with the businesses, so the card shows the name and the category and no offer
 * line at all — never "[Offer summary]" and never a guess. Publishing a discount the partner
 * has not agreed to is a promise the club cannot keep.
 *
 * **The code is never on the page.** Every card says it is in the members' WhatsApp
 * community, which is where it actually lives.
 */
export const partnerSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  offer: z.string().min(1).optional(),
});

export const partnersSchema = z.object({
  /** The filter's categories, in the order they are offered. */
  categories: z.array(z.string().min(1)).min(1),
  partners: z.array(partnerSchema).min(1),
});

export type Partners = z.infer<typeof partnersSchema>;
export type Partner = z.infer<typeof partnerSchema>;

export function parsePartners(value: unknown): Partners {
  return partnersSchema.parse(value);
}

/* -----------------------------------------------------------------------------------------
 * The committee
 * ----------------------------------------------------------------------------------------- */

/**
 * A role on the committee, and the person in it when the club has supplied one.
 *
 * ⚠️ **`name` is optional and is absent for everybody today.** The page shows roles only.
 * A name is personal data the club publishes about a volunteer, so it appears when the club
 * supplies it and not before — never "[Name]", never an avatar with a question mark in it.
 *
 * **No email address either.** "Contact the committee" points at the old site's committee
 * page until the club confirms addresses.
 *
 * `welfare` marks the two roles that get highlighted, because somebody looking for them is
 * usually looking for them urgently.
 */
export const committeeRoleSchema = z.object({
  role: z.string().min(1),
  name: z.string().min(1).optional(),
  welfare: z.boolean().optional(),
});

export const committeeSchema = z.object({
  officers: z.array(committeeRoleSchema).min(1),
  volunteers: z.array(committeeRoleSchema).min(1),
});

export type Committee = z.infer<typeof committeeSchema>;

export function parseCommittee(value: unknown): Committee {
  return committeeSchema.parse(value);
}

/* -----------------------------------------------------------------------------------------
 * Newsletters
 * ----------------------------------------------------------------------------------------- */

/**
 * One monthly issue.
 *
 * ⚠️ **`href` is optional, and no issue has one today.** Per-issue addresses on the old site
 * have not been confirmed, so every card links to the newsletter archive through
 * `links.json`'s `newsletters` key instead. A card must never link to a guessed URL.
 *
 * **`summary` is optional too** and is absent everywhere: the mockup's "[First line of the
 * issue as a summary]" is a placeholder, so a card shows its title and month alone.
 *
 * `month` is `YYYY-MM` — sortable, unambiguous, and formatted for display rather than read
 * out as it is stored.
 */
export const newsletterSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, 'month must be YYYY-MM'),
  title: z.string().min(1),
  href: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
});

export const newslettersSchema = z.object({
  issues: z.array(newsletterSchema).min(1),
});

export type Newsletters = z.infer<typeof newslettersSchema>;
export type Newsletter = z.infer<typeof newsletterSchema>;

export function parseNewsletters(value: unknown): Newsletters {
  return newslettersSchema.parse(value);
}

/* -----------------------------------------------------------------------------------------
 * Rendering an absent fact
 * ----------------------------------------------------------------------------------------- */

/**
 * What a page shows where the club has not supplied a value.
 *
 * ⚠️ **One string, in one place, and it is a behaviour rather than a convention.** The rule
 * this repository actually has is *"never ship a placeholder"* — so the alternative to this
 * is not a nicer wording, it is `undefined` reaching the page, or a bracketed marker, or
 * somebody filling in a plausible number. `tests/unit/club-content.test.ts` asserts the
 * absent case for each optional fact by name.
 */
export const TO_BE_CONFIRMED = 'To be confirmed';

/** The price of something the club has not priced yet, in the club's own words. */
export const PRICE_TO_BE_CONFIRMED = 'Price to be confirmed';

/* -----------------------------------------------------------------------------------------
 * What is coming up
 * ----------------------------------------------------------------------------------------- */

/**
 * Where an entry's date comes from.
 *
 * ⚠️ **This is the whole reason the type exists.** The Nightingale Nightmare date lives in
 * `race.json` and the latest newsletter's month lives in `newsletters.json`. Copying either
 * into this file would create a second place to change it — and the failure is silent, because
 * a card showing last year's date looks exactly like a card showing this year's.
 *
 * So an entry either **names the file its date comes from** or carries its own `startsAt`.
 */
export const eventDateSourceSchema = z.enum(['race', 'newsletter', 'own']);

export const comingUpSchema = z.object({
  /** Stable, so a test can name one entry without matching on its title. */
  key: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Root-relative, with the trailing slash — `trailingSlash` is `'always'`. */
  href: z
    .string()
    .regex(/^\/[^/].*\/$/u, 'href must be root-relative and end in a slash'),
  /** What the card's button says. */
  cta: z.string().min(1),
  dateFrom: eventDateSourceSchema,
  /** Only for `dateFrom: 'own'`. A UTC instant. */
  startsAt: z.string().datetime().optional(),
  /**
   * When this stops being "coming up". A UTC instant, compared at **build time**.
   *
   * ⚠️ **Absent means it never expires**, which is right for the newsletter card — there is
   * always a latest issue — and wrong for anything with a date. A race that has been run is
   * the single most embarrassing thing for a club's front page to still be advertising.
   */
  showUntil: z.string().datetime().optional(),
});

export const eventsSchema = z.object({
  comingUp: z.array(comingUpSchema).min(1),
});

export type Events = z.infer<typeof eventsSchema>;
export type ComingUp = z.infer<typeof comingUpSchema>;

export function parseEvents(value: unknown): Events {
  return eventsSchema.parse(value);
}

/**
 * The entries still worth showing at a given moment.
 *
 * ## Why this compares instants and never a calendar date
 *
 * ⚠️ **`showUntil` is a UTC instant and `now` is a UTC instant, and that is the entire
 * design.** The tempting implementation is to compare "today" against a date string, which
 * means building a civil date from a clock — and this repository has already paid for that:
 * `new Date().toISOString().slice(0, 10)` reads as "today" and means "today in UTC", so on a
 * British Summer Time morning it names **yesterday** for an hour.
 *
 * Nightingale Nightmare is raced the weekend **after** the clocks change. A card that expires
 * an hour late, or an hour early, on precisely that weekend is the defect this shape rules
 * out rather than mitigates: two instants have no timezone to get wrong.
 *
 * `entries-retention.test.ts`' sibling for this is `club-content.test.ts`, which runs it
 * across the clocks-change weekend in both directions.
 *
 * ## A build-time filter, and what that means for the club
 *
 * The site is static, so this runs once when `dist/` is built. **An expired card leaves the
 * page at the next build, not at midnight** — which is a trade the club should know about
 * rather than discover. It is the same property that makes every other content change need a
 * rebuild, and it is why `showUntil` is set generously rather than to the minute.
 */
export function comingUpOn(events: Events, now: Date): readonly ComingUp[] {
  return events.comingUp.filter(
    (entry) => entry.showUntil === undefined || new Date(entry.showUntil) > now,
  );
}
