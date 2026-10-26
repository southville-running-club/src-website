import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PhotosLinkMessage } from '@src/shared';

import { photosLink, sendPhotosMessage } from '../../worker/photos-outbox';

/**
 * What the race photos drain hands Resend (slice 5, ADR-069).
 *
 * **`fetch` is stubbed, so nothing here can reach Resend** — the brief's "in tests, email goes
 * to a fake sender". The thing worth protecting is the request body the provider would
 * receive, which is `email.test.ts`'s argument and its shape.
 */

const CONFIG = { apiKey: 're_test_not_a_real_key', apiBase: 'https://resend.invalid' };

const MESSAGE: PhotosLinkMessage = {
  id: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5f01',
  reason: 'first_link',
  eventSlug: 'nn-2026',
  eventName: 'Nightingale Nightmare 2026',
  bib: '125',
  recipient: 'runner@example.com',
  replyTo: 'nightingalenightmare@example.com',
  photoCount: 2,
  attempts: 1,
};

const TOKEN = 'Fx0photosOutboxUnitTestToken_AAAAAAAAAAAAAA';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function stub(status = 200): () => Captured | null {
  let captured: Captured | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      captured = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
      return new Response(JSON.stringify({ id: 'msg_1' }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return () => captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the link', () => {
  it('points at the runner’s private page on the production site', () => {
    expect(photosLink('nn-2026', TOKEN)).toBe(
      `https://new.southvillerunningclub.co.uk/nn/2026/photos/p/${TOKEN}/`,
    );
  });

  it('is nothing for a running this site has no page for', () => {
    expect(photosLink('zz-not-a-running', TOKEN)).toBeNull();
  });
});

describe('the email Resend is sent', () => {
  it('goes to the runner from the race sender, replying to the race mailbox, as text', async () => {
    const captured = stub();
    const link = photosLink(MESSAGE.eventSlug, TOKEN)!;

    const outcome = await sendPhotosMessage(MESSAGE, link, CONFIG);

    expect(outcome).toEqual({ ok: true, providerMessageId: 'msg_1' });
    const sent = captured()!;
    expect(sent.url).toBe('https://resend.invalid/emails');
    expect(sent.body).toMatchObject({
      from: 'Southville Running Club <nn@send.southvillerunningclub.co.uk>',
      to: ['runner@example.com'],
      reply_to: 'nightingalenightmare@example.com',
      subject: 'Your Nightingale Nightmare photos are ready',
    });
    expect(sent.body.text).toContain(link);
    expect(sent.body.text).toContain('We found you in 2 photos');
    // Text only: no design was supplied for an HTML part.
    expect(sent.body).not.toHaveProperty('html');
  });

  it('carries the row id as its idempotency key, so a retry is the same request', async () => {
    const captured = stub();

    await sendPhotosMessage(MESSAGE, photosLink(MESSAGE.eventSlug, TOKEN)!, CONFIG);

    expect(captured()!.headers['idempotency-key']).toBe(`photos-outbox:${MESSAGE.id}`);
  });

  it('leaves out a reply address the race does not have, rather than sending null', async () => {
    const captured = stub();

    await sendPhotosMessage(
      { ...MESSAGE, replyTo: null },
      photosLink(MESSAGE.eventSlug, TOKEN)!,
      CONFIG,
    );

    expect(captured()!.body).not.toHaveProperty('reply_to');
  });

  it('reports a rate limit as one, and any other refusal as its status alone', async () => {
    stub(429);
    expect(
      await sendPhotosMessage(MESSAGE, photosLink(MESSAGE.eventSlug, TOKEN)!, CONFIG),
    ).toEqual({ ok: false, rateLimited: true, error: '429 rate limited' });

    stub(422);
    expect(
      await sendPhotosMessage(MESSAGE, photosLink(MESSAGE.eventSlug, TOKEN)!, CONFIG),
    ).toEqual({ ok: false, rateLimited: false, error: 'http 422' });
  });
});
