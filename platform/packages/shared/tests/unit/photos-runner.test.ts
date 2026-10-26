import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  deriveLinkToken,
  isLinkToken,
  linkTokenHash,
  mailtoLink,
  photoDownloadName,
} from '../../src/photos-runner';

const KEY = 'a-photos-link-key-for-this-test-only';
const ROW = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5f01';

describe('a private link token', () => {
  it('is derived from the key and the outbox row, as 43 URL-safe characters', async () => {
    const token = await deriveLinkToken(KEY, ROW);

    expect(isLinkToken(token)).toBe(true);
    expect(token).toHaveLength(43);
    // Node's own HMAC, so the Web Crypto call is checked against a second implementation
    // rather than against itself.
    expect(token).toBe(
      createHmac('sha256', KEY).update(`photos-link:${ROW}`).digest('base64url'),
    );
  });

  it('is the same for the same row every time, which is what makes a retry safe', async () => {
    expect(await deriveLinkToken(KEY, ROW)).toBe(await deriveLinkToken(KEY, ROW));
  });

  it('differs for another row, and for another key', async () => {
    const token = await deriveLinkToken(KEY, ROW);

    expect(await deriveLinkToken(KEY, '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5f02')).not.toBe(
      token,
    );
    expect(await deriveLinkToken(`${KEY}-rotated`, ROW)).not.toBe(token);
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
