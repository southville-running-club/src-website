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
    /** "Southbank Club, Dean Lane". */
    venue: z.string().min(1),
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
