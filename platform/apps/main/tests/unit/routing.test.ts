import { describe, expect, it } from 'vitest';
import { NN_HOST, resolveRoute } from '../../worker/routing';

const OTHER_HOSTS = ['localhost', 'src-main.workers.dev', 'southvillerunningclub.co.uk'];

describe('the local hostname behaves as the live one', () => {
  // So `http://nn.localhost:8787/` is the public shape rather than an approximation of
  // it. Browsers resolve `*.localhost` to 127.0.0.1 with no `/etc/hosts` entry.
  it.each(['nn.localhost', 'nn.localhost:8787', NN_HOST])(
    'treats %s as the race host',
    (host) => {
      expect(resolveRoute(host, '/').path).toBe('/nn/');
      expect(resolveRoute(host, '/membership/').path).toBe('/nn/membership/');
    },
  );

  it('does not mistake the bare apex for the race host', () => {
    expect(resolveRoute('southvillerunningclub.co.uk', '/').path).toBe('/');
    expect(resolveRoute('localhost', '/').path).toBe('/');
  });
});

describe('the nn. hostname serves Nightingale Nightmare at its own root', () => {
  it('maps / to /nn/', () => {
    expect(resolveRoute(NN_HOST, '/')).toEqual({
      path: '/nn/',
      isNightingaleNightmare: true,
    });
  });

  it('maps a sub-path into /nn/', () => {
    expect(resolveRoute(NN_HOST, '/privacy/').path).toBe('/nn/privacy/');
  });

  it('has no /nn address of its own — it is prefixed like anything else', () => {
    // There is one address for this race and it is `nn.<apex>/`. `/nn/` is where the
    // pages sit *in the build*, so `new.<apex>/nn` will serve them without anything
    // moving — but it is not an address on this hostname, so it resolves to `/nn/nn/`
    // and 404s like any other path that is not the race.
    expect(resolveRoute(NN_HOST, '/nn/').path).toBe('/nn/nn/');
    expect(resolveRoute(NN_HOST, '/nn/privacy/').path).toBe('/nn/nn/privacy/');
  });

  it('serves shared build assets unprefixed, so styling resolves', () => {
    // The regression this guards: prefixing `/_astro/x.css` to `/nn/_astro/x.css` gives a
    // 404 and an unstyled page, and it would only be noticed by looking.
    expect(resolveRoute(NN_HOST, '/_astro/index.a1b2c3.css')).toEqual({
      path: '/_astro/index.a1b2c3.css',
      isNightingaleNightmare: false,
    });
    expect(resolveRoute(NN_HOST, '/favicon.svg').path).toBe('/favicon.svg');
  });
});

describe('the nn. hostname cannot reach anything that is not the race', () => {
  // The assertion this file exists for.
  //
  // From Phase 5 the club website is in this same build, unfinished. Nothing in it may be
  // publicly reachable on the race domain, and "we will remember to check" is not a
  // control. Every one of these resolves inside /nn/, where no such page exists, so each
  // 404s.
  it.each([
    '/membership/',
    '/results/',
    '/about/',
    '/newsletter/2026-01/',
    '/kit/',
    '/index.html',
  ])('sends %s inside /nn/, where it does not exist', (path) => {
    const route = resolveRoute(NN_HOST, path);
    expect(route.path.startsWith('/nn/')).toBe(true);
    expect(route.isNightingaleNightmare).toBe(true);
  });

  it('cannot be escaped by asking for the root index directly', () => {
    expect(resolveRoute(NN_HOST, '/index.html').path).toBe('/nn/index.html');
  });
});

describe('every other hostname passes through untouched', () => {
  it.each(OTHER_HOSTS)('leaves %s alone', (host) => {
    expect(resolveRoute(host, '/').path).toBe('/');
    expect(resolveRoute(host, '/membership/').path).toBe('/membership/');
    // The preview URL shows the whole build on purpose — reviewing it is the point.
    expect(resolveRoute(host, '/nn/').path).toBe('/nn/');
  });

  it('still recognises Nightingale Nightmare content by its real path', () => {
    expect(resolveRoute('localhost', '/nn/').isNightingaleNightmare).toBe(true);
    expect(resolveRoute('localhost', '/').isNightingaleNightmare).toBe(false);
  });
});
