import { describe, expect, it } from 'vitest';
import { BOM, csvDocument, csvField, csvRow } from '../../src/csv';

/**
 * CSV escaping, and the cases that come from real entrants rather than from a specification.
 *
 * The club's exports are opened in Excel and in Numbers by two volunteers, from data typed by
 * the public into a form. Every assertion below is one of those two facts meeting the other.
 */

describe('csvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('Harriet')).toBe('Harriet');
    expect(csvField('Southville Running Club')).toBe('Southville Running Club');
  });

  it('quotes a value containing a comma', () => {
    // The case that splits one column into two, silently, and shifts every column after it.
    expect(csvField('Bristol & West AC, the Bees')).toBe('"Bristol & West AC, the Bees"');
  });

  it('quotes a value containing a double quote, and doubles the quote', () => {
    // The case that swallows the rest of the file rather than merely one row.
    expect(csvField('the "Bees"')).toBe('"the ""Bees"""');
  });

  it('handles a comma and a quote in the same value, which is the seed fixture', () => {
    // `Bristol & West AC, "the Bees"` is in `seed.sql` for exactly this, so a laptop meets it
    // without anybody having to invent it.
    expect(csvField('Bristol & West AC, "the Bees"')).toBe(
      '"Bristol & West AC, ""the Bees"""',
    );
  });

  it('quotes a value containing a newline', () => {
    // A medical note is a textarea, so its line breaks are ordinary rather than exotic.
    expect(csvField('Asthma\nInhaler in a waist belt')).toBe(
      '"Asthma\nInhaler in a waist belt"',
    );
    expect(csvField('one\r\ntwo')).toBe('"one\r\ntwo"');
  });

  it('quotes leading and trailing whitespace so a round trip preserves it', () => {
    expect(csvField(' Harriet')).toBe('" Harriet"');
    expect(csvField('Harriet ')).toBe('"Harriet "');
  });

  it('renders an absent value as an empty field, not as the word null', () => {
    // An entrant who named no club is the ordinary case in that column, and a
    // column of the word "null" is how a spreadsheet gets retyped by hand.
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('renders a number as a number, with no quoting and no apostrophe', () => {
    expect(csvField(1500)).toBe('1500');
    expect(csvField(0)).toBe('0');
  });

  describe('formula injection', () => {
    // A spreadsheet evaluates a cell beginning with one of these as a formula, and the values
    // here were typed into a public form.

    it('neutralises the four leads a spreadsheet would evaluate', () => {
      expect(csvField('=1+1')).toBe("'=1+1");
      expect(csvField('+1')).toBe("'+1");
      expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");

      // A leading tab, neutralised. It needs no quotes afterwards — the apostrophe is now the
      // first character, so the tab is no longer at a boundary where a reader could trim it.
      expect(csvField('\tHarriet')).toBe("'\tHarriet");
    });

    it('still quotes a neutralised value that also needs quoting', () => {
      expect(csvField('=1,2')).toBe('"\'=1,2"');
    });

    it('leaves a leading hyphen alone, because real data starts with one', () => {
      // **The deliberate gap.** A hyphen is the one character on the usual list that appears
      // in real names and club names, and a spreadsheet only evaluates it when what follows
      // parses as an expression. Mangling a real name to guard against a string nobody has
      // typed is the worse trade — and it is the kind of corruption found on race morning.
      expect(csvField('-Brislington')).toBe('-Brislington');
    });
  });
});

describe('csvRow', () => {
  it('joins fields with commas, escaping each', () => {
    expect(csvRow(['Nwosu', 'Harriet', null, 1500])).toBe('Nwosu,Harriet,,1500');
  });
});

describe('csvDocument', () => {
  it('opens with a byte-order mark, so Excel reads it as UTF-8', () => {
    // Without it, `Inés O'Rourke` and `Lena Sørensen` open as mojibake — and both are in the
    // seed, because both are ordinary in a Bristol running club.
    const document = csvDocument(['Name'], [['Lena Sørensen']]);

    expect(document.startsWith(BOM)).toBe(true);
    expect(document).toContain('Lena Sørensen');
  });

  it('separates rows with CRLF and ends with one', () => {
    expect(csvDocument(['a', 'b'], [['1', '2']])).toBe(`${BOM}a,b\r\n1,2\r\n`);
  });

  it('renders a header and no rows without a stray blank line', () => {
    expect(csvDocument(['a', 'b'], [])).toBe(`${BOM}a,b\r\n`);
  });

  it('survives the whole awkward row end to end', () => {
    const document = csvDocument(
      ['Last name', 'First name', 'Club'],
      [['O’Rourke', 'Inés', 'Bristol & West AC, "the Bees"']],
    );

    expect(document).toBe(
      `${BOM}Last name,First name,Club\r\nO’Rourke,Inés,"Bristol & West AC, ""the Bees"""\r\n`,
    );
  });
});
