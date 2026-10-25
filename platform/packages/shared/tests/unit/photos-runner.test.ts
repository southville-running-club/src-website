import { describe, expect, it } from 'vitest';

import {
  isLinkToken,
  linkTokenHash,
  mailtoLink,
  mintLinkToken,
  photoDownloadName,
} from '../../src/photos-runner';

describe('a private link token', () => {
  it('is minted as 43 URL-safe characters, and differently each time', () => {
    const one = mintLinkToken();
    const two = mintLinkToken();

    expect(isLinkToken(one)).toBe(true);
    expect(one).toHaveLength(43);
    expect(one).not.toBe(two);
  });

  it('refuses anything that is not that shape, before the database is asked', () => {
    expect(isLinkToken('a'.repeat(42))).toBe(false);
    expect(isLinkToken('a'.repeat(44))).toBe(false);
    expect(isLinkToken(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isLinkToken(`${'a'.repeat(42)}/`)).toBe(false);
  });

  it('is stored as its SHA-256, in the lower-case hex photos.link holds', async () => {
    // The published test vector for "abc", so the hash is the standard one and not a variant.
    expect(await linkTokenHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('the ready-written emails', () => {
  it('address the club and carry a subject and a body, encoded', () => {
    expect(
      mailtoLink('race@example.com', "That's me in NN26-0412", 'Bib 125 & more'),
    ).toBe(
      "mailto:race@example.com?subject=That's%20me%20in%20NN26-0412&body=Bib%20125%20%26%20more",
    );
  });
});

describe('a downloaded photo', () => {
  it('is named by its short ID, the number a runner quotes', () => {
    expect(photoDownloadName('NN26-0412')).toBe('NN26-0412.jpg');
  });
});
