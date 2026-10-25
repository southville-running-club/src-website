import { describe, expect, it } from 'vitest';

import {
  PHOTOS_EMAIL_COPY,
  photosLinkEmailBody,
  type PhotosLinkMessage,
} from '../../src/photos-links';

/**
 * The link email's words (brief §10, for Kayleigh's sign-off). These tests hold the brief's
 * draft copy word for word, so an edit to it is a visible change rather than a quiet one.
 */

const MESSAGE: PhotosLinkMessage = {
  id: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5f01',
  reason: 'first_link',
  eventSlug: 'nn-2026',
  eventName: 'Nightingale Nightmare 2026',
  bib: '125',
  recipient: 'runner@example.com',
  replyTo: 'race@example.com',
  photoCount: 3,
  attempts: 1,
};

const LINK = 'https://new.southvillerunningclub.co.uk/nn/2026/photos/p/abc/';

describe('the link email', () => {
  it('says the brief’s three sentences, with the link on a line of its own', () => {
    const { subject, text } = photosLinkEmailBody(MESSAGE, LINK);

    expect(subject).toBe('Your Nightingale Nightmare photos are ready');
    expect(text.split('\n')).toEqual([
      "We found you in 3 photos from Sunday's race.",
      '',
      LINK,
      '',
      "This link is just for you, so there's no password. Forward this email to anyone you'd like to see them.",
      '',
      "Not keen on one of them? Reply with the photo ID shown under it and we'll take it down.",
      '',
      'Southville Running Club',
    ]);
  });

  it('says one photo, not one photos', () => {
    expect(PHOTOS_EMAIL_COPY.found(1)).toBe(
      "We found you in 1 photo from Sunday's race.",
    );
  });

  it('names nobody and no bib, so a forwarded email gives away nothing but the link', () => {
    const { text } = photosLinkEmailBody(MESSAGE, LINK);

    expect(text).not.toContain(MESSAGE.bib);
    expect(text).not.toContain(MESSAGE.recipient);
  });
});
