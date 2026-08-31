import { describe, expect, it } from 'vitest';
import { renderEntryEmailHtml } from '../../worker/email-skin';
import type { OutboxMessage } from '@src/shared';

/**
 * Design fidelity as a test, not a request. The values below are extracted from
 * `nn-email-reference-template.html`, the approved design, and are the specification —
 * `email-skin.ts`'s own header comment says so. A failing assertion here names the offending
 * value, so drift is a build failure rather than something Kayleigh has to notice by eye.
 */

const SEVEN_COLOURS = new Set([
  '#FFFFFF',
  '#161616',
  '#D2D2D2',
  '#565656',
  '#7A0E0E',
  '#E9E9E4',
  '#E3E3E3',
]);

const THREE_STACKS = new Set([
  "Georgia, 'Times New Roman', serif",
  'Georgia, serif',
  "'Courier New', Courier, monospace",
]);

const SIX_SIZES = new Set([11, 12, 13, 15, 16, 25]);

const TEMPLATES = [
  'entry_confirmed',
  'entry_refunded',
  'entry_transferred_out',
  'entry_transferred_in',
] as const;

function message(overrides: Partial<OutboxMessage> = {}): OutboxMessage {
  return {
    id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    template: 'entry_confirmed',
    recipient: 'runner@example.com',
    attempts: 0,
    purchaseReference: '11111111-2222-3333-4444-555555555555',
    eventName: 'Nightingale Nightmare 2026',
    eventDate: 'Sunday 1 November 2026',
    amountPence: 1800,
    entrantFirstName: 'Inés',
    replyTo: 'nightingalenightmare@southvillerunningclub.co.uk',
    ...overrides,
  };
}

/**
 * `hasBanner` defaults to `true` — the shape every drain run has whenever
 * `fetchBannerAttachment()` succeeds, which is the case every other describe block in this
 * file is written against. The `false` case has its own block below.
 */
function render(
  template: (typeof TEMPLATES)[number],
  overrides: Partial<OutboxMessage> = {},
  hasBanner = true,
) {
  const html = renderEntryEmailHtml(message({ template, ...overrides }), hasBanner);

  expect(html, `${template} did not render`).not.toBeNull();

  return html as string;
}

function allHexColours(html: string): string[] {
  return html.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
}

function allFontFamilies(html: string): string[] {
  return [...html.matchAll(/font-family:\s*([^;]+);/g)].map((match) => match[1] ?? '');
}

function allFontSizes(html: string): number[] {
  return [...html.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
}

describe('every send stays inside the seven colours', () => {
  for (const template of TEMPLATES) {
    it(`${template} uses no colour outside the palette`, () => {
      const html = render(template);
      const offenders = allHexColours(html).filter(
        (hex) => !SEVEN_COLOURS.has(hex.toUpperCase()),
      );

      expect(offenders, `unapproved colour(s): ${offenders.join(', ')}`).toEqual([]);
      // The negative case: a send that used none of the seven would pass the check above
      // vacuously. Assert the palette is actually exercised.
      expect(allHexColours(html).length).toBeGreaterThan(0);
    });
  }
});

describe('every send uses only the three approved font stacks', () => {
  for (const template of TEMPLATES) {
    it(`${template} declares no other font-family`, () => {
      const html = render(template);
      const families = allFontFamilies(html);
      const offenders = families.filter((family) => !THREE_STACKS.has(family));

      expect(
        offenders,
        `unapproved font-family value(s): ${offenders.join(' | ')}`,
      ).toEqual([]);
      expect(families.length).toBeGreaterThan(0);
    });
  }
});

describe('every send uses only the six approved sizes', () => {
  for (const template of TEMPLATES) {
    it(`${template} declares no other font-size`, () => {
      const html = render(template);
      const sizes = allFontSizes(html);
      const offenders = sizes.filter((size) => !SIX_SIZES.has(size));

      expect(offenders, `unapproved font-size(s): ${offenders.join(', ')}px`).toEqual([]);
      expect(sizes.length).toBeGreaterThan(0);
    });
  }
});

describe('the structural measurements from the reference design are present', () => {
  for (const template of TEMPLATES) {
    it(`${template} carries the card's max-width, border, stamp offset and rotation`, () => {
      const html = render(template);

      expect(html).toContain('max-width:600px');
      expect(html).toContain('border:1px solid #E3E3E3');
      expect(html).toContain('margin-top:-19px');
      expect(html).toContain('rotate(-2deg)');
    });

    it(`${template} gives Outlook a literal 600px table, everyone else a fluid one`, () => {
      // The card is `width="100%"` for every real browser and mail-client renderer, so it
      // shrinks to fit a narrow viewport rather than forcing horizontal scroll — but Outlook's
      // Word engine ignores `max-width`, so the one literal `width="600"` left in the markup
      // is inside an `[if mso]` conditional comment, invisible to every other client's DOM.
      const html = render(template);
      const mso = /<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g;
      const msoOnly = [...html.matchAll(mso)].map((match) => match[1]).join('\n');

      expect(msoOnly).toContain('width="600"');
      expect(html.replace(mso, '')).not.toContain('width="600"');
    });

    it(`${template} has zero corner radius anywhere`, () => {
      expect(render(template)).not.toContain('border-radius');
    });
  }
});

describe('the banner is a CID attachment, not a remote URL', () => {
  // ADR-026: the banner ships as part of the message rather than as an https:// reference, so
  // no mail client ever makes an HTTP request to render it and there is nothing for that
  // request to disclose. `email.ts`'s `fetchBannerAttachment()` gives the attachment this
  // exact content_id; the two have to agree for the reference to resolve to anything.
  for (const template of TEMPLATES) {
    it(`${template}'s banner <img> references cid:nn-email-banner, not an https:// URL`, () => {
      const html = render(template);
      const img = html.match(/<img[^>]*>/)?.[0];

      expect(img, 'no <img> tag found').toBeDefined();
      expect(img).toContain('src="cid:nn-email-banner"');
      expect(img).not.toContain('https://');
    });
  }
});

describe('the banner alt text renders when the image is blocked', () => {
  // The wrapping <td> is `line-height:0; font-size:0;` — the standard email image-gap killer —
  // which zeroes the alt text too unless the <img> itself carries its own typography. A
  // blocked image with no fallback leaves a ~10px broken-image icon and nothing else, on "the
  // one message a runner is waiting for" (email.ts's own words).
  for (const template of TEMPLATES) {
    it(`${template}'s banner <img> declares its own non-zero font-size`, () => {
      const html = render(template);
      const img = html.match(/<img[^>]*>/)?.[0];

      expect(img, 'no <img> tag found').toBeDefined();
      expect(img).toMatch(/font-size:15px/);
      expect(img).not.toMatch(/font-size:0/);
    });
  }

  it('is built from the message, not a hardcoded year-scoped string', () => {
    // Isolated to the alt attribute itself, not the whole page — the CTA elsewhere in the
    // card links to a year-scoped race-day page by a separate, already year-hardcoded
    // constant, which would make a whole-page "not 2026" assertion fail for an unrelated
    // reason and prove nothing about the banner alt text this test is about.
    const altOf = (html: string) => html.match(/alt="([^"]*)"/)?.[1];

    const html2026 = render('entry_confirmed', {
      eventName: 'Nightingale Nightmare 2026',
      eventDate: 'Sunday 1 November 2026',
    });
    const html2027 = render('entry_confirmed', {
      eventName: 'Nightingale Nightmare 2027',
      eventDate: 'Sunday 7 November 2027',
    });

    expect(altOf(html2026)).toBe(
      'Southville Running Club presents Nightingale Nightmare 2026, Sunday 1 November 2026',
    );
    expect(altOf(html2027)).toBe(
      'Southville Running Club presents Nightingale Nightmare 2027, Sunday 7 November 2027',
    );
    // The negative case: a hardcoded string would put 2026's date in the 2027 alt text too.
    expect(altOf(html2027)).not.toContain('2026');
  });

  it('does not invent a distance, since the artwork does not carry one', () => {
    expect(render('entry_confirmed')).not.toMatch(/\balt="[^"]*km\b/);
  });
});

describe('table-based layout, no forbidden constructs', () => {
  for (const template of TEMPLATES) {
    it(`${template} has no <style> block, no data: URI, and every <table> is a plain layout table`, () => {
      const html = render(template);

      expect(html).not.toContain('<style');
      expect(html).not.toContain('src="data:');

      const tableOpenTags = html.match(/<table\b[^>]*>/g) ?? [];
      expect(tableOpenTags.length).toBeGreaterThan(0);
      for (const tag of tableOpenTags) {
        expect(
          tag,
          `table opened without cellpadding/cellspacing/border: ${tag}`,
        ).toMatch(/cellpadding="0"/);
        expect(tag).toMatch(/cellspacing="0"/);
        expect(tag).toMatch(/border="0"/);
      }
    });

    it(`${template} uses <div> only as a plain text container, never for layout`, () => {
      // The approved reference design itself wraps the heading in a `<div>` — this is the one
      // `<div>` the specification permits, and it carries text styling only (font, colour,
      // spacing), never `display`, `float` or `position`, which is what would make it a layout
      // device rather than a styled line of text sitting inside an already-laid-out `<td>`.
      const html = render(template);
      const divOpenTags = html.match(/<div\b[^>]*>/g) ?? [];

      for (const tag of divOpenTags) {
        expect(tag).not.toMatch(/display\s*:/);
        expect(tag).not.toMatch(/float\s*:/);
        expect(tag).not.toMatch(/position\s*:/);
      }
    });

    it(`${template} styles buttons as an <a> inside a <td>, never a <button>`, () => {
      expect(render(template)).not.toContain('<button');
    });
  }
});

describe('one wrapper, four bodies', () => {
  it('the banner tag is byte-identical across all four sends', () => {
    const bannerOf = (html: string) => html.match(/<img[^>]*>/)?.[0];
    const banners = TEMPLATES.map((template) => bannerOf(render(template)));

    expect(banners.every((banner) => banner === banners[0])).toBe(true);
    expect(banners[0]).toBeDefined();
  });

  it('the stamp table structure is byte-identical across all four sends, only its text differs', () => {
    const stampShellOf = (html: string) => {
      const match =
        /<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:-19px;">[\s\S]*?<\/table>/.exec(
          html,
        );
      return match?.[0].replace(/<span[\s\S]*?<\/span>/, '<span>STAMP</span>');
    };
    const shells = TEMPLATES.map((template) => stampShellOf(render(template)));

    expect(shells.every((shell) => shell === shells[0])).toBe(true);
    expect(shells[0]).toBeDefined();
  });

  it('the footer block is byte-identical across all four sends for the same Reply-To', () => {
    const footerOf = (html: string) =>
      html.slice(html.indexOf('Questions about your entry?'));
    const footers = TEMPLATES.map((template) => footerOf(render(template)));

    expect(footers.every((footer) => footer === footers[0])).toBe(true);
    expect(footers[0].length).toBeGreaterThan(0);
  });
});

describe('the banner degrades gracefully when this run could not fetch it', () => {
  // fetchBannerAttachment() in email.ts returns null on any failure — never throws — and the
  // confirmation a runner is waiting for must still send. Nothing here points at an
  // attachment that does not exist.
  for (const template of TEMPLATES) {
    it(`${template} renders with no <img> tag at all, and everything else intact`, () => {
      const html = render(template, {}, false);

      expect(html).not.toContain('<img');
      expect(html).not.toContain('cid:');
      // The stamp still renders — the send is not lost, only the banner.
      expect(html).toMatch(/font-family:'Courier New', Courier, monospace/);
    });

    it(`${template} does not pull the stamp up over the card's own top border`, () => {
      // margin-top:-19px assumes the banner occupies its full height above the stamp. With
      // no banner row at all, that offset would pull the stamp up past the card's own edge
      // instead — so it goes to 0 in exactly this case, and only this case.
      const html = render(template, {}, false);

      expect(html).toContain('margin-top:0;');
      expect(html).not.toContain('margin-top:-19px');
    });
  }
});

describe('escaping — a name is never trusted raw', () => {
  it('escapes an apostrophe in a first name', () => {
    const html = render('entry_transferred_in', { entrantFirstName: "D'Angelo" });

    expect(html).not.toContain("D'Angelo");
    expect(html).toContain('D&#39;Angelo');
  });

  it('leaves a non-ASCII name untouched, since only five characters are ever escaped', () => {
    const html = render('entry_confirmed', { entrantFirstName: 'Renée' });

    // `escapeHtml` only ever rewrites &, <, >, " and ' — a name with none of those passes
    // through byte-for-byte, which is correct for a page declaring `charset="UTF-8"`.
    expect(html).toContain('Commiserations, Renée.');
    expect(html).not.toContain('&eacute;');
    expect(html).not.toContain('&#233;');
  });

  it('a missing first name renders a graceful heading, not "Hello ,"', () => {
    const html = render('entry_refunded', { entrantFirstName: null });

    expect(html).not.toContain(' ,');
    expect(html).toContain('Hello,');
  });
});

describe('the Reply-To address is read, never a hardcoded literal', () => {
  it('the footer mailto and visible text both use OutboxMessage.replyTo', () => {
    const html = render('entry_confirmed', { replyTo: 'someone@example.com' });

    expect(html).toContain('mailto:someone@example.com');
    expect(html).toContain('>someone@example.com<');
    expect(html).not.toContain('nightingalenightmare@gmail.com');
  });
});

describe('the transfer-out send names nobody, on purpose', () => {
  it('never prints entrantFirstName in the heading, even when one is supplied', () => {
    // The join at send time returns the INCOMING runner's name for this template, not the
    // outgoing one's — printing it here would name the wrong person. See email-skin.ts's
    // header comment.
    const html = render('entry_transferred_out', {
      entrantFirstName: 'Someone Else Entirely',
    });

    expect(html).not.toContain('Someone Else Entirely');
    expect(html).toContain('Hello,');
  });
});

describe('the amount is never doubled with its own symbol', () => {
  it('a paid amount carries exactly one £', () => {
    const html = render('entry_confirmed', { amountPence: 1800 });

    expect(html).toContain('£18.00');
    expect(html).not.toContain('££');
  });

  it('a free place says Free, never £0.00 or £Free', () => {
    const html = render('entry_refunded', { amountPence: 0 });

    expect(html).toContain('there is nothing to refund');
    expect(html).not.toContain('£0.00');
    expect(html).not.toContain('£Free');
  });
});

describe('a template this file does not know', () => {
  it('renders null rather than throwing', () => {
    expect(
      renderEntryEmailHtml(message({ template: 'not_a_real_template' }), true),
    ).toBeNull();
  });
});
