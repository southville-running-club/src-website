import { describe, expect, it } from 'vitest';

import {
  isPartRead,
  isPhotoSize,
  parseTypedBibs,
  photoObjectKey,
} from '../../src/photos-check';

describe('where a copy lives in the bucket', () => {
  it('is the key the laptop uploads it under', () => {
    // `object_key()` in tools/photos/racephotos/upload.py writes exactly this, and
    // `tools/photos/tests/test_upload.py` asserts its own side of the same layout.
    expect(
      photoObjectKey('nn-2026', '00000000-0000-4000-8000-000000000001', 'medium'),
    ).toBe('nn-2026/00000000-0000-4000-8000-000000000001/medium.jpg');
  });

  it('knows the three sizes the laptop makes, and nothing else', () => {
    expect(['full', 'medium', 'thumb'].every(isPhotoSize)).toBe(true);
    expect(isPhotoSize('original')).toBe(false);
    expect(isPhotoSize('../full')).toBe(false);
  });
});

describe('reading the bibs a checker typed', () => {
  it('takes one bib, as worn, leading zeros and all', () => {
    expect(parseTypedBibs(' 0311 ')).toEqual(['0311']);
  });

  it('takes several, for a photo with several runners in it', () => {
    expect(parseTypedBibs('125, 0311  42')).toEqual(['125', '0311', '42']);
  });

  it('drops a bib typed twice', () => {
    expect(parseTypedBibs('125 125')).toEqual(['125']);
  });

  it('refuses anything that is not a bib, rather than saving the rest', () => {
    expect(parseTypedBibs('125 12a')).toBeNull();
    expect(parseTypedBibs('12?')).toBeNull();
    expect(parseTypedBibs('123456789')).toBeNull();
  });

  it('reads nothing typed as nothing, not as a refusal', () => {
    expect(parseTypedBibs('   ')).toEqual([]);
  });
});

describe('a part read', () => {
  it('is a read with a question mark where a digit could not be made out', () => {
    expect(isPartRead('12?')).toBe(true);
    expect(isPartRead('125')).toBe(false);
  });
});
