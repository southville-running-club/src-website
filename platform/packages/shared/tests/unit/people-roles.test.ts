import { describe, expect, it } from 'vitest';
import {
  RESERVED_ROLES,
  ROLE_GROUPS,
  grantable,
  groupFor,
  displayName,
  firstName,
  initialsFor,
  matchesSearch,
  parsePeopleQuery,
  peopleHref,
  pendingLabel,
  roleDiff,
  roleLabel,
  roleSummary,
  sameRoles,
  typedNameMatches,
} from '../../src/people-roles';

/**
 * The three pure questions `/admin/people/` asks, and the reason they are pure.
 *
 * ADR-046's page computes a diff on the server and, once the enhancement lands, again in the
 * browser. **Two implementations of that is how the pending pills come to disagree with what
 * the save actually did**, so there is one, it lives in a leaf module, and this is where its
 * edges are held.
 */

describe('grouping a role by its slug', () => {
  it('reads the prefix', () => {
    expect(groupFor('nn-admin').id).toBe('nn');
    expect(groupFor('nn-results').id).toBe('nn');
    expect(groupFor('timing-marshal').id).toBe('timing');
  });

  it('puts everything else in Club, including the two club roles', () => {
    expect(groupFor('src-admin').id).toBe('club');
    expect(groupFor('people-admin').id).toBe('club');
  });

  /**
   * ⚠️ The documented failure. A role in an area nobody has added a group for lands in Club
   * rather than vanishing from the page — the right failure, and still a failure. This test is
   * here so that the day it is wrong, it is wrong loudly.
   */
  it('lands an unknown area in Club rather than dropping it', () => {
    expect(groupFor('parkrun-admin').id).toBe('club');
    expect(groupFor('').id).toBe('club');
  });

  it('has exactly one group that takes the rest', () => {
    expect(ROLE_GROUPS.filter((group) => group.prefix === null)).toHaveLength(1);
    // And it is last, because `groupFor` falls through to the end of the list.
    expect(ROLE_GROUPS[ROLE_GROUPS.length - 1]?.prefix).toBeNull();
  });
});

describe('labelling a role', () => {
  it('drops the group prefix, because the card above already says it', () => {
    expect(roleLabel('nn-admin')).toBe('Admin');
    expect(roleLabel('nn-results')).toBe('Results');
    expect(roleLabel('timing-marshal')).toBe('Marshal');
  });

  it('keeps a club slug whole, since there is no prefix to drop', () => {
    expect(roleLabel('people-admin')).toBe('People admin');
  });

  /** The club's own initialism, not a coined word — it names this repository and the role. */
  it('says SRC rather than Src', () => {
    expect(roleLabel('src-admin')).toBe('SRC admin');
  });

  it('never returns an empty label', () => {
    expect(roleLabel('')).toBe('');
    expect(roleLabel('-')).toBe('-');
  });

  it('reads a pending change in the group’s short word', () => {
    expect(pendingLabel('nn-results')).toBe('NN results');
    expect(pendingLabel('timing-marshal')).toBe('Timing marshal');
    expect(pendingLabel('people-admin')).toBe('Club people admin');
  });
});

describe('the diff a save would apply', () => {
  it('names what is added and what is taken away', () => {
    expect(roleDiff(['nn-admin'], ['nn-results', 'timing-marshal'])).toEqual({
      added: ['nn-results', 'timing-marshal'],
      removed: ['nn-admin'],
    });
  });

  it('is empty when the two sets agree', () => {
    expect(roleDiff(['nn-admin', 'nn-results'], ['nn-results', 'nn-admin'])).toEqual({
      added: [],
      removed: [],
    });
  });

  /**
   * **Order and repetition are not differences.** The wanted set arrives from a form, where the
   * order is the document's rather than the database's — and a diff that reported that would
   * put an "Unsaved" tag on a switch nobody touched.
   */
  it('does not care about order or repetition', () => {
    expect(roleDiff(['nn-admin'], ['nn-admin', 'nn-admin'])).toEqual({
      added: [],
      removed: [],
    });
  });

  /** The batch cannot carry a reserved role, so a difference in one is not a change to report. */
  it('ignores the two roles the batch may not carry', () => {
    expect(roleDiff(['super-admin', 'registered', 'nn-admin'], ['nn-admin'])).toEqual({
      added: [],
      removed: [],
    });
    expect(RESERVED_ROLES).toEqual(['super-admin', 'registered']);
  });

  it('reduces a set to what this page may change', () => {
    expect(grantable(['registered', 'nn-admin', 'super-admin', 'nn-admin'])).toEqual([
      'nn-admin',
    ]);
  });

  it('compares two sets as sets', () => {
    expect(sameRoles(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameRoles(['a'], ['a', 'b'])).toBe(false);
    expect(sameRoles(['a', 'registered'], ['a'])).toBe(true);
  });
});

describe('the typed name on the super-admin confirmation', () => {
  it('matches exactly', () => {
    expect(typedNameMatches('Priya Nair', 'Priya Nair')).toBe(true);
  });

  it('is trimmed and case-insensitive, because it is a gesture rather than a spelling test', () => {
    expect(typedNameMatches('  priya nair  ', 'Priya Nair')).toBe(true);
    expect(typedNameMatches('PRIYA NAIR', 'Priya Nair')).toBe(true);
  });

  /** A name pasted out of the table can arrive carrying a double space. */
  it('collapses whitespace inside the name', () => {
    expect(typedNameMatches('Priya  Nair', 'Priya Nair')).toBe(true);
  });

  it('refuses something else', () => {
    expect(typedNameMatches('Priya', 'Priya Nair')).toBe(false);
    expect(typedNameMatches('', 'Priya Nair')).toBe(false);
  });

  /**
   * ⚠️ **The case that would remove the confirmation entirely.** Somebody with no name
   * recorded — every account that signed up before the profile column existed — would be
   * confirmable by typing nothing at all if an empty expected name matched an empty box.
   */
  it('never matches when there is no name to type', () => {
    expect(typedNameMatches('', null)).toBe(false);
    expect(typedNameMatches('', '')).toBe(false);
    expect(typedNameMatches('   ', '  ')).toBe(false);
    expect(typedNameMatches('anything', null)).toBe(false);
  });
});

describe('reading the page’s state off the query string', () => {
  const parse = (search: string) => parsePeopleQuery(new URLSearchParams(search));

  it('defaults to the person view with nobody selected', () => {
    expect(parse('')).toEqual({
      view: 'person',
      person: null,
      filter: 'all',
      q: '',
      saved: false,
      confirming: false,
    });
  });

  it('reads every value it knows', () => {
    const query = parse(
      'view=role&person=3f2504e0-4f89-41d3-9a0c-0305e82c3301&filter=roles&q=nair&saved=1&confirm=super',
    );
    expect(query.view).toBe('role');
    expect(query.person).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(query.filter).toBe('roles');
    expect(query.q).toBe('nair');
    expect(query.saved).toBe(true);
    expect(query.confirming).toBe(true);
  });

  /**
   * **Every value falls back rather than refusing.** A hand-edited or truncated URL is not an
   * attack, and a 400 on this page is a volunteer stuck with a link somebody sent them.
   */
  it('falls back rather than refusing an unknown value', () => {
    expect(parse('view=sideways').view).toBe('person');
    expect(parse('filter=purple').filter).toBe('all');
    expect(parse('saved=yes').saved).toBe(false);
    expect(parse('confirm=1').confirming).toBe(false);
  });

  /**
   * The one value validated strictly, because it is passed to the database — and dropped here
   * rather than carried down to be refused there.
   */
  it('drops a person id that is not a uuid', () => {
    expect(parse('person=nobody').person).toBeNull();
    expect(parse('person=').person).toBeNull();
    expect(parse("person=' or 1=1--").person).toBeNull();
  });

  it('trims and caps the search box', () => {
    expect(parse('q=%20%20nair%20%20').q).toBe('nair');
    expect(parse(`q=${'x'.repeat(400)}`).q).toHaveLength(100);
  });
});

describe('building a link back into the page', () => {
  it('leaves the empty values out', () => {
    expect(peopleHref('/admin/people/', { view: 'person', filter: 'all', q: '' })).toBe(
      '/admin/people/',
    );
  });

  it('carries the ones that are set', () => {
    const href = peopleHref('/admin/people/', {
      view: 'role',
      person: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      filter: 'roles',
      q: 'nair',
    });
    expect(href).toContain('view=role');
    expect(href).toContain('person=3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(href).toContain('filter=roles');
    expect(href).toContain('q=nair');
  });

  /**
   * A filter press is not a save, and a `role="status"` banner that reappears on every
   * navigation is a page announcing something that did not just happen.
   */
  it('drops saved and confirm unless they are asked for', () => {
    const href = peopleHref('/admin/people/', {
      person: 'x',
      saved: false,
      confirming: false,
    });
    expect(href).not.toContain('saved');
    expect(href).not.toContain('confirm');
  });

  it('round-trips through the parser', () => {
    const href = peopleHref('/admin/people/', {
      view: 'role',
      person: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      filter: 'none',
      q: 'a b',
    });
    const parsed = parsePeopleQuery(new URLSearchParams(href.split('?')[1] ?? ''));
    expect(parsed.view).toBe('role');
    expect(parsed.filter).toBe('none');
    expect(parsed.q).toBe('a b');
  });
});

describe('how a person reads in the list', () => {
  it('summarises what they hold', () => {
    expect(roleSummary(['registered'])).toBe('Member');
    expect(roleSummary(['registered', 'nn-admin'])).toBe('1 role');
    expect(roleSummary(['registered', 'nn-admin', 'nn-results'])).toBe('2 roles');
  });

  /** Super admin is the whole answer — it is not "4 roles" with a caveat. */
  it('says super admin above everything else', () => {
    expect(roleSummary(['registered', 'nn-admin', 'super-admin'])).toBe('Super admin');
  });

  it('takes initials from a name', () => {
    expect(initialsFor({ name: 'Priya Nair', email: 'p@example.com' })).toBe('PN');
    expect(initialsFor({ name: 'Jo', email: 'j@example.com' })).toBe('J');
    expect(initialsFor({ name: 'Ada Marie Lovelace', email: 'a@example.com' })).toBe(
      'AL',
    );
  });

  /** Every account from before the profile column has no name, and a blank circle is no use. */
  it('falls back to the address when there is no name', () => {
    expect(initialsFor({ name: null, email: 'tom@example.com' })).toBe('T');
    expect(initialsFor({ name: '   ', email: 'tom@example.com' })).toBe('T');
  });

  it('searches the name and the address, case-insensitively', () => {
    const person = { name: 'Priya Nair', email: 'priya.nair@example.com' };
    expect(matchesSearch(person, 'nair')).toBe(true);
    expect(matchesSearch(person, 'PRIYA')).toBe(true);
    expect(matchesSearch(person, 'example.com')).toBe(true);
    expect(matchesSearch(person, '')).toBe(true);
    expect(matchesSearch(person, 'okafor')).toBe(false);
  });

  it('searches an address when there is no name to search', () => {
    expect(matchesSearch({ name: null, email: 'tom@example.com' }, 'tom')).toBe(true);
  });
});

describe('naming somebody, in one place', () => {
  it('prefers the name', () => {
    expect(displayName({ name: 'Priya Nair', email: 'p@example.com' })).toBe(
      'Priya Nair',
    );
    expect(firstName({ name: 'Priya Nair', email: 'p@example.com' })).toBe('Priya');
  });

  it('falls back to the address when there is no name', () => {
    expect(displayName({ name: null, email: 'tom@example.com' })).toBe('tom@example.com');
    expect(firstName({ name: null, email: 'tom@example.com' })).toBe('tom@example.com');
  });

  /**
   * ⚠️ **The case that separates `name ?? email` from `name || email`**, and the reason this
   * helper exists at all. A name column holding an empty string rather than null keeps the
   * empty string under `??` — so the page would ask somebody to type an address while the
   * server compared what they typed against nothing, and `typedNameMatches` refuses an empty
   * expected name. The confirmation could then never be completed by anybody.
   */
  it('treats an empty or blank name as no name', () => {
    expect(displayName({ name: '', email: 'tom@example.com' })).toBe('tom@example.com');
    expect(displayName({ name: '   ', email: 'tom@example.com' })).toBe(
      'tom@example.com',
    );
    expect(firstName({ name: '  ', email: 'tom@example.com' })).toBe('tom@example.com');
  });

  /** The whole point: what the page asks for is what the server checks. */
  it('gives the confirmation something typeable for a person with no name', () => {
    const nameless = { name: '', email: 'tom@example.com' };
    expect(typedNameMatches(displayName(nameless), displayName(nameless))).toBe(true);
  });
});
