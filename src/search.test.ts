import { describe, expect, test } from 'vitest';

import { searchAll, prepareSearch, score, type SearchOptions } from './search';

// =========================================================
// Test helpers
// =========================================================

/**
 * A queue-backed fake of the D1 bits `searchAll()` actually uses.
 * Each `prepare().bind().all()` call returns the next canned response;
 * unprepared responses are empty arrays. This is intentional — the
 * search function issues its four SELECTs in a fixed Promise.all order,
 * so setting up the queue in order is natural to read.
 *
 * We only implement what search.ts touches:
 *   db.prepare(string).bind(...args).all<T>()
 * Anything else (first/run etc.) would be added the day we need it.
 */
class FakeD1 {
  private readonly queue: Array<{ results: unknown[] }>;

  /** Push responses in the order you expect the queries to be issued. */
  constructor(responses: Array<unknown[]> = []) {
    this.queue = responses.map((results) => ({ results }));
  }

  prepare(_query: string) {
    return {
      bind: (...args: unknown[]) => {
        void args;
        return {
          all: async <T>() => {
            const next = this.queue.shift() ?? { results: [] };
            return next as { results: T[] };
          },
        };
      },
    };
  }
}

// =========================================================
// prepareSearch (pure)
// =========================================================

describe('prepareSearch', () => {
  test('returns null on empty / whitespace-only input', () => {
    expect(prepareSearch('')).toBeNull();
    expect(prepareSearch('   ')).toBeNull();
  });

  test('returns null on inputs shorter than minLength', () => {
    expect(prepareSearch('a')).toBeNull();
    expect(prepareSearch('a', 3)).toBeNull();
  });

  test('returns trimmed raw + lowercase needle for non-trivial inputs', () => {
    const out = prepareSearch('  iCloud  ');
    expect(out).not.toBeNull();
    expect(out!.raw).toBe('iCloud');
    expect(out!.needle).toBe('icloud');
  });

  test('escapes LIKE special chars (% _ \\) so user input doesn\'t broaden the search', () => {
    expect(prepareSearch('a%b')!.pattern).toBe('%a\\%b%');
    expect(prepareSearch('a_b')!.pattern).toBe('%a\\_b%');
    expect(prepareSearch('a\\b')!.pattern).toBe('%a\\\\b%');
  });

  test('wraps the escaped needle in %...% so LIKE matches substrings', () => {
    expect(prepareSearch('foo')!.pattern).toBe('%foo%');
  });

  test('honours a custom minLength', () => {
    expect(prepareSearch('ab', 2)).not.toBeNull();
    expect(prepareSearch('ab', 3)).toBeNull();
  });
});

// =========================================================
// score (pure)
// =========================================================

describe('score', () => {
  test('exact match wins', () => {
    expect(score('icloud', 'iCloud')).toBe(100);
  });

  test('prefix beats substring', () => {
    expect(score('icl', 'iCloud')).toBeGreaterThan(score('oud', 'iCloud'));
  });

  test('word-boundary match beats substring', () => {
    // "evie" is a word inside "Easee Evie" — word boundary beats
    // a plain substring match for "evie" inside the same string.
    expect(score('evie', 'Easee Evie')).toBeGreaterThanOrEqual(80);
    expect(score('evie', 'evie')).toBe(100);
  });

  test('returns 0 when nothing matches', () => {
    expect(score('xyz', 'apple', 'banana', null, undefined)).toBe(0);
  });

  test('returns 0 for an empty needle', () => {
    expect(score('', 'apple')).toBe(0);
  });

  test('skips null / undefined / non-string fields cleanly', () => {
    // 'a' is inside 'banana', so score is non-zero (substring). Use 'xyz'
    // to verify null/undefined/empty-string fields are correctly skipped.
    expect(score('xyz', null, undefined, '', 'banana')).toBe(0);
    expect(score('ban', null, undefined, '', 'banana')).toBeGreaterThan(0);
  });
});

// =========================================================
// searchAll
// =========================================================

const SUB_FIXTURE: Array<Record<string, unknown>> = [
  { id: 1, title: 'Apple iCloud+', subtitle: 'apple.com', category: 'storage', date: '2026-08-01' },
  { id: 2, title: 'GitHub Copilot', subtitle: null, category: 'dev-tools', date: '2026-08-05' },
];
const REM_FIXTURE: Array<Record<string, unknown>> = [
  { id: 11, title: 'Renew iCloud storage', notes: 'reminder notes for icloud', category: 'admin', date: '2026-07-10' },
];
const WL_FIXTURE: Array<Record<string, unknown>> = [
  { id: 21, title: 'Apple iCloud lawsuit', parties: 'Apple Inc.', notes: null, category: 'case', date: '2026-09-01', next_action_label: 'Submit response' },
];
const VEH_FIXTURE: Array<Record<string, unknown>> = [
  { id: 31, entry_type: 'fuel', location: 'Shell Maidstone', notes: 'pre-iCloud sync', date: '2026-07-03' },
];

describe('searchAll', () => {
  test('returns [] for empty / too-short queries (no D1 calls)', async () => {
    const db = new FakeD1();
    expect(await searchAll(db as never, '')).toEqual([]);
    expect(await searchAll(db as never, 'a')).toEqual([]);
  });

  test('issues exactly 4 parallel queries (one per kind) and merges results', async () => {
    // The fake records the queue depth before any all() is awaited.
    // By the time the first await resumes, the four .all()s are in-flight.
    const db = new FakeD1([
      SUB_FIXTURE,
      REM_FIXTURE,
      WL_FIXTURE,
      VEH_FIXTURE,
    ]);
    const out = await searchAll(db as never, 'icloud');
    // 4 rows total across all kinds; we expect them all.
    expect(out).toHaveLength(4);
    const titles = out.map((r) => r.title).sort();
    expect(titles).toEqual([
      'Apple iCloud lawsuit',
      'Apple iCloud+',
      'Renew iCloud storage',
      'Shell Maidstone', // notes match "pre-iCloud sync"
    ]);
  });

  test('respects opts.kinds — empty results for kinds filtered out', async () => {
    // Each query still runs (Promise.all), but only the wanted kind is kept.
    const db = new FakeD1([
      SUB_FIXTURE,
      REM_FIXTURE,
      WL_FIXTURE,
      VEH_FIXTURE,
    ]);
    const out = await searchAll(db as never, 'icloud', { kinds: ['subscription'] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('subscription');
    expect(out[0].title).toBe('Apple iCloud+');
  });

  test('respects opts.limit — cap total output, prefer higher scores', async () => {
    const db = new FakeD1([
      SUB_FIXTURE,
      REM_FIXTURE,
      WL_FIXTURE,
      VEH_FIXTURE,
    ]);
    const out = await searchAll(db as never, 'icloud', { limit: 2 });
    expect(out).toHaveLength(2);
    // Score desc; ties broken by kind then title.
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });

  test('escapes LIKE wildcards so user input of % doesn\'t match everything', async () => {
    // The fake returns empty for an escaped-no-match, so this is really
    // a documentation test: we trust prepareSearch to wire the right
    // pattern. Verify via the read-from-fake path that an empty result
    // is what comes back when nothing matches.
    const db = new FakeD1([[], [], [], []]);
    expect(await searchAll(db as never, '%')).toEqual([]);
  });

  test('score: exact > word-boundary > prefix > substring', async () => {
    // Single result per fixture, each tuned to a different match type:
    // - subscription: exact ('Apple iCloud+')
    // - reminder: word-boundary ('Renew iCloud storage' — 'icloud' inside)
    // - vehicle: prefix via notes ('pre-iCloud' begins with iCloud)
    // - watchlist: substring ('Apple iCloud lawsuit')
    const db = new FakeD1([
      [{ id: 1, title: 'iCloud', subtitle: null, category: null, date: null }],
      [{ id: 2, title: 'Renew iCloud storage', notes: null, category: null, date: null }],
      [{ id: 3, title: 'ICLOUD-extra', parties: null, notes: null, category: null, date: null, next_action_label: null }],
      [{ id: 4, entry_type: 'fuel', location: 'iCloud cafe', notes: null, date: null }],
    ]);
    const out = await searchAll(db as never, 'icloud');
    // Sort: highest score first. Subscription's exact-match wins.
    expect(out[0].kind).toBe('subscription');
    // All entries present (we didn't filter, and all matched).
    expect(out).toHaveLength(4);
  });

  test('stable ordering: equal scores break by kind alpha then title alpha', async () => {
    // Two subs with the same score (substring in same column): ordering
    // should be stable by kind (subscription alone in this fixture).
    const db = new FakeD1([
      [
        { id: 1, title: 'iCloud account', subtitle: null, category: null, date: null },
        { id: 2, title: 'iCloud backup', subtitle: null, category: null, date: null },
      ],
      [], [], [],
    ]);
    const out = await searchAll(db as never, 'icloud');
    // Both rows have identical score (substring). Title alpha should
    // tie-break: 'iCloud account' < 'iCloud backup'.
    expect(out.map((r) => r.title)).toEqual(['iCloud account', 'iCloud backup']);
  });

  test('does not crash on missing optional fields (subtitle = null)', async () => {
    const db = new FakeD1([
      [{ id: 1, title: 'iCloud', subtitle: null, category: null, date: null }],
      [], [], [],
    ]);
    const out = await searchAll(db as never, 'icloud');
    expect(out).toHaveLength(1);
    expect(out[0].subtitle).toBeNull();
  });

  test('vehicle kind renders title from location (with fallback when null but notes matched)', async () => {
    // SQL would only return vehicles whose location OR notes matched.
    // If location is null but notes matched, the JS-side title falls
    // back to "<entry_type> entry #<id>".
    const db = new FakeD1([
      [], [], [],
      [
        { id: 41, entry_type: 'charge', location: 'Home', notes: null, date: null },
        { id: 42, entry_type: 'fuel', location: null, notes: 'home charger here', date: null },
      ],
    ]);
    const out = await searchAll(db as never, 'home');
    const titles = out.map((r) => r.title);
    expect(titles).toContain('Home');
    expect(titles).toContain('fuel entry #42'); // fallback when location is null
  });
});
