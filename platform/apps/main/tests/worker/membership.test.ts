import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';

/**
 * What membership costs, painted onto a static page by the Worker.
 *
 * ## ⚠️ Two states, and only one of them can be reached through `SELF`
 *
 * The local stack is up during `./dev test`, so every fetch below gets the **painted** page:
 * real prices, the options open. The other state — the database unreachable — is what the
 * page ships as, and the only honest way to assert it is to read the built file off disk
 * rather than to try to break the database from inside `workerd`.
 *
 * That split is the point rather than a workaround. **The shipped state is the safe state**,
 * and a test that only ever saw the painted one would not notice the day somebody put a
 * price back into the markup "so the page isn't blank" — which would quietly re-create the
 * second source of truth this whole arrangement exists to remove.
 *
 * ## Why the figures are written out here
 *
 * `400`, `2700` and `2300` are seeded by `20260921100000_create_membership_schema.sql` and
 * asserted there as well, by `packages/db/tests/membership.test.ts`. Restating them is
 * deliberate: this file is checking that the number in the database is the number on the
 * page, and deriving the expectation from the same query the Worker makes would assert only
 * that the Worker agrees with itself.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

/**
 * The built file, exactly as it ships — the assets binding's answer, before the Worker has
 * rewritten anything.
 *
 * ⚠️ **`env.ASSETS.fetch` rather than `readFileSync`, and the difference is not stylistic.**
 * These tests run **inside** `workerd`, which has no filesystem: a `node:fs` read of `dist/`
 * fails with *"no such file or directory"* naming a path that plainly exists on the host.
 * That reads as a stale build and is not one. The assets binding is how a Worker reaches
 * `dist/` in the runtime, so it is how a test in the runtime reaches it too — and it has the
 * better property anyway, that it returns what is actually served rather than what is on
 * disk near it.
 */
async function built(path: string): Promise<string> {
  // ⚠️ **The cast is this suite's own idiom, not a shortcut.** The pool types `env` as
  // `Cloudflare.Env`, which `workers-types` declares as an empty interface for a project to
  // merge into — and merging `ASSETS` into it globally is what the obvious fix looks like.
  // It also gives that interface a member, which breaks `nn-entry-open.test.ts`'s
  // `env as Record<string, unknown>` casts, because an empty interface casts freely and a
  // populated one does not. So the binding is reached the way that file already reaches
  // `ENTRIES_ENTRY_KEY`: locally, where it is used, changing nothing for anybody else.
  const assets = (env as unknown as { ASSETS: Fetcher }).ASSETS;

  const response = await assets.fetch(new Request(`${SITE}${path}`, { method: 'GET' }));

  expect(response.status, `the assets binding has nothing at ${path}`).toBe(200);

  return await response.text();
}

/** Whitespace is a build artefact; what a reader sees is not. */
function squash(html: string): string {
  return html.replace(/\s+/gu, ' ');
}

/**
 * The words on the page, with the markup taken out.
 *
 * ⚠️ **A test at this layer matches the markup string, and a sentence with a painted value in
 * it does not exist there as a sentence.** `Join the club for £4 a year` is
 * `Join the club for <span data-membership-price="club">£4</span> a year` on the wire, so
 * `toContain` on the readable form fails against a page that is perfectly correct — the same
 * shape as the `<wbr>` trap `admin.test.ts` strips for, one element along. Playwright matches
 * `textContent` and never sees any of this, which is why the acceptance layer stays green
 * while this one goes red.
 *
 * Assertions about what somebody *reads* go through here; assertions about attributes — which
 * is most of this file — stay on the raw markup, because that is where an attribute is.
 */
function text(html: string): string {
  return squash(html.replace(/<[^>]*>/gu, ' '))
    .replace(/ ([.,])/gu, '$1')
    .trim();
}

describe('the price the club charges is in the database and nowhere else', () => {
  /**
   * ⚠️ **The whole reason this mechanism exists.** The club raises its fees about once a year
   * and asked that it be one `update` rather than a deploy:
   *
   * ```sql
   * update membership.membership_types set price_pence = 500 where code = 'club';
   * ```
   *
   * That is only true while no built file carries a figure. One literal anywhere below and
   * the statement above stops changing what a member reads, with nothing looking wrong.
   */
  it.each(['/', '/membership/', '/membership/join/'])(
    'ships %s with no price in it',
    async (path) => {
      const page = await built(path);

      for (const figure of ['£4', '£27', '£23']) {
        expect(page, `${path} has ${figure} written into the markup`).not.toContain(
          figure,
        );
      }

      expect(page).toContain('Price to be confirmed');
    },
  );

  it('paints the annual price onto the home page', async () => {
    const page = await (await SELF.fetch(`${SITE}/`)).text();

    expect(text(page)).toContain('Join the club for £4 a year');
  });

  it('paints both prices onto the membership page', async () => {
    const page = squash(await (await SELF.fetch(`${SITE}/membership/`)).text());

    expect(page).toContain('£4');
    expect(page).toContain('£27');
    expect(page).not.toContain('Price to be confirmed');
  });

  /**
   * ⚠️ **£27 with no account of it is a number somebody argues with.** £4 of it is club
   * membership and £23 is England Athletics' own registration fee — not the club's money,
   * exactly like the £2 Unattached Runner Levy on a race entry. The split is painted from
   * `ea_fee_pence` rather than written down, so it cannot disagree with the price above it.
   */
  it('says which part of the England Athletics price is not the club’s', async () => {
    const page = squash(await (await SELF.fetch(`${SITE}/membership/`)).text());

    expect(page).toContain('£4 club membership plus £23 England Athletics registration');
  });

  it('paints the minimum age rather than stating it', async () => {
    const shipped = await built('/membership/join/');
    const served = await (await SELF.fetch(`${SITE}/membership/join/`)).text();

    expect(shipped).toContain('data-membership-minimum-age');
    expect(text(served)).toContain('You need to be 18 or over to join the club.');
  });
});

describe('an option nobody can price is an option nobody can choose', () => {
  /**
   * ⚠️ **The trap this repository has already paid for once, in the other direction.**
   *
   * A `required` control that is hidden and empty makes the browser refuse to submit the
   * form — silently, with a console line nobody has open and **no request on the wire**. It
   * took the race entry form down for every signed-in runner and was found on production by
   * luck, hours before entries opened. `hidden` does not stop a control being validated;
   * `disabled` does, and it also keeps the control out of the submission.
   *
   * So the membership radios ship `disabled` as well as `hidden`, and both come off together.
   * This asserts the shipped half; the test below asserts they actually come off.
   */
  it('ships the membership options closed', async () => {
    const page = squash(await built('/membership/join/'));

    // The group is a `<fieldset>`, so one `disabled` closes everything inside it.
    expect(page).toMatch(/<fieldset[^>]*data-membership-options[^>]*disabled/u);
    expect(page).toMatch(/<fieldset[^>]*data-membership-options[^>]*hidden/u);

    // And each radio says so itself, so removing the fieldset later cannot quietly open them.
    for (const code of ['club', 'club_ea']) {
      expect(page, code).toMatch(
        new RegExp(`<input[^>]*data-membership-input="${code}"[^>]*disabled`, 'u'),
      );
    }
  });

  it('opens them once a price has been read', async () => {
    const page = squash(await (await SELF.fetch(`${SITE}/membership/join/`)).text());

    expect(page).not.toMatch(/<fieldset[^>]*data-membership-options[^>]*disabled/u);
    expect(page).not.toMatch(/<fieldset[^>]*data-membership-options[^>]*hidden/u);

    for (const code of ['club', 'club_ea']) {
      expect(page, code).not.toMatch(
        new RegExp(`<input[^>]*data-membership-input="${code}"[^>]*disabled`, 'u'),
      );
    }
  });

  /**
   * The shipped page says the price could not be shown and points at the club's existing
   * form. Painting a price makes that untrue, so painting a price is what removes it.
   */
  it('drops the “we can’t show what membership costs” line once it can', async () => {
    const shipped = squash(await built('/membership/join/'));

    // It ships **visible**, which is the honest answer when the options above are closed.
    expect(shipped).toContain('data-membership-prices-unavailable');
    expect(shipped).not.toMatch(/data-membership-prices-unavailable[^>]*hidden/u);

    const served = squash(await (await SELF.fetch(`${SITE}/membership/join/`)).text());

    // ⚠️ **`hidden`, not deleted.** `HideHandler` sets the attribute — which takes the line
    // out of the accessibility tree and off the screen — and leaves the text in the markup.
    // Asserting the sentence is absent from the *string* would fail on a page that is
    // behaving exactly as designed, so the attribute is what this reads.
    expect(served).toMatch(/data-membership-prices-unavailable[^>]*hidden/u);
  });
});

describe('the application form itself', () => {
  it('serves, and is not indexed like everything else here', async () => {
    const response = await SELF.fetch(`${SITE}/membership/join/`);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(page).toContain('name="robots" content="noindex"');
    expect(page).toContain('Join Southville Running Club');
  });

  /**
   * ⚠️ **Eighteen fields and a honeypot, named exactly as the schema expects them.**
   *
   * `parseMembershipApplication` reads a submitted body by key. A renamed input is a field
   * that silently arrives as `undefined` and is reported to the applicant as missing — on a
   * box they can plainly see they filled in. Nothing else in this suite compares the two
   * lists, because nothing else can: the schema is in `packages/shared` and the markup is
   * built output.
   */
  it('names every box the schema reads', async () => {
    const page = await built('/membership/join/');

    for (const field of [
      'title',
      'firstName',
      'lastName',
      'email',
      'phone',
      'dateOfBirth',
      'addressLine1',
      'addressLine2',
      'cityTown',
      'postcode',
      'country',
      'membershipType',
      'previousAffiliation',
      'previousClubName',
      'eaUrn',
      'agreeCodeOfConduct',
      'agreePrivacyPolicy',
      'agreeDisciplinaryPolicy',
    ]) {
      expect(page, `no control is named ${field}`).toContain(`name="${field}"`);
    }
  });

  it('carries a honeypot no person is shown', async () => {
    const page = squash(await built('/membership/join/'));

    expect(page).toMatch(/<input[^>]*name="website"[^>]*hidden/u);
    expect(page).toMatch(/<input[^>]*name="website"[^>]*tabindex="-1"/u);
    // ⚠️ A password manager filling this on somebody's behalf would get them refused.
    expect(page).toMatch(/<input[^>]*name="website"[^>]*autocomplete="off"/u);
  });

  /**
   * ⚠️ **The country list is the whole of ISO 3166-1, and the point is that it is not a
   * guess.** A short list refuses a real member — somebody who cannot finish an application
   * because their country is not offered — and nothing would ever report that as a defect.
   *
   * It also may not hold the same country twice: ICU names fifteen withdrawn codes after
   * their successors, so a naive sweep produces "Zimbabwe" twice and "Serbia" three times.
   */
  it('offers every country, once each, preselected on the United Kingdom', async () => {
    const page = await built('/membership/join/');
    const options = [
      ...page.matchAll(/<option value="([A-Z]{2})"[^>]*>([^<]+)<\/option>/gu),
    ];

    expect(options.length).toBeGreaterThan(200);
    expect(new Set(options.map((match) => match[1])).size).toBe(options.length);
    expect(new Set(options.map((match) => match[2])).size).toBe(options.length);

    expect(page).toMatch(/<option value="GB"[^>]*selected/u);
    // `UK` is an exceptional reservation and is *not* the United Kingdom's code. Offering
    // both puts one country in the list twice.
    expect(page).not.toContain('<option value="UK"');
  });

  /**
   * ⚠️ **It asked; now it tells, and this asserts the question does not come back.**
   *
   * The form carried *"May we pass your name, date of birth and email address to England
   * Athletics?"* as a real yes/no. The club processes **every** new member on the England
   * Athletics portal — that is how a membership is set up, and England Athletics is what
   * sends the payment link — so the question asked permission for something that happened
   * either way, and told anybody answering "no" something false.
   */
  it('states the England Athletics sharing rather than asking about it', async () => {
    const page = squash(await built('/membership/join/'));

    expect(page).not.toContain('name="eaPortalConsent"');
    expect(text(page)).toContain('Your details go to England Athletics.');
  });

  it('says who sends the payment link, and that it is not the club', async () => {
    // The club takes no payment on this website. Three places said the Membership Officer
    // would "be in touch about paying", which is not what happens.
    const page = text(await built('/membership/join/'));

    expect(page).toContain('England Athletics will send you the link to pay');
    expect(page).not.toContain('in touch about paying');
  });
});

describe('the form is the way in now', () => {
  /**
   * ⚠️ **This replaces "is linked from no club page".** That guard existed while the form
   * stored nothing, and said in its own comment to be deleted in the same change that made
   * the form real. This is that change.
   *
   * The assertion inverts because the risk inverts. What can now regress silently is
   * `links.json`'s `join` key: every page reads it, so reverting that one key sends every
   * "Join the club" button back to Squarespace and no page looks wrong.
   */
  it('links the club’s own form rather than the old site', async () => {
    const page = await built('/membership/');

    expect(page).toContain('href="/membership/join/"');
    expect(page, 'still points at the old Squarespace form').not.toContain(
      'southvillerunningclub.co.uk/new-members',
    );
  });

  it('no longer calls it “on our old site”', async () => {
    // The label and the destination moved together. A button reading "Join the club on our
    // old site" that goes to a page on this one is worse than either.
    const page = squash(await built('/membership/'));

    expect(page).toMatch(/Join the club\s*<\/a>/u);
  });

  /**
   * ⚠️ **The form must not offer a way back to itself.** Its "we can't show what membership
   * costs" notice reused `links.json`'s `join` key while that key meant "the old site". The
   * key now means this page.
   */
  it('gives the form’s fallback somewhere other than the form', async () => {
    const page = await built('/membership/join/');
    const form = page.slice(page.indexOf('<form'), page.indexOf('</form>'));

    expect(form).not.toContain('href="/membership/join/"');
    expect(page).toContain('data-membership-prices-unavailable');
  });
});

/**
 * ⚠️ **The whitespace trap, caught by a machine rather than by somebody reading a rendered
 * page.**
 *
 * Prettier reflows an Astro template so a newline falls between a word and the expression
 * after it, and Astro compresses that newline to **nothing**. The result is `at theSouthbank
 * Club`, `live onour old site`, `orask the Membership Officer`, `BristolBS3 1DB`, `1DB.Map` —
 * five separate instances in this repository, every one of them invisible in the source, every
 * one found by a human squinting at a built page or a screenshot.
 *
 * Nothing could see them: the value is present, the markup is valid, the page does not
 * overflow, and axe has no opinion about a missing space.
 *
 * **This is what can see them.** Every value that gets interpolated into prose is checked for
 * being glued to the word before or after it. It is deliberately about the *content values*
 * rather than about tags, because `theSouthbank` has no tag in the middle of it — a scan for
 * `[a-z]<a` would have missed the very instance that prompted this.
 */
describe('no interpolated value is glued to the words around it', () => {
  /** The club facts that appear inside sentences rather than in their own element. */
  const INTERPOLATED = [
    'Southbank Club',
    'Tuesdays and Thursdays',
    'Meet 6.00pm for a 6.15pm start',
    'Bristol',
    'BS3 1DB',
  ];

  const PAGES = [
    '/',
    '/membership/',
    '/membership/join/',
    '/membership/join/complete/',
    '/run-with-us/',
    '/about/',
    '/news/',
  ];

  it.each(PAGES)('%s', async (path) => {
    // Tags become spaces: a value legitimately sitting inside its own element is not glued to
    // anything, and treating it as though it were would make this test unpassable.
    const text = (await built(path)).replace(/<[^>]*>/gu, ' ');

    for (const value of INTERPOLATED) {
      const glued = new RegExp(
        `(\\w${escapeForRegExp(value)})|(${escapeForRegExp(value)}\\w)`,
        'u',
      );

      const match = glued.exec(text);

      expect(
        match,
        match === null
          ? ''
          : `${path} renders "${match[0]}" — a space was compressed away around "${value}"`,
      ).toBeNull();
    }
  });
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
