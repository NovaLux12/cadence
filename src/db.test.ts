import { describe, expect, test } from 'vitest';

import {
  todayLondon,
  normalizeCostPence,
  fmtGBP,
  computeNextDue,
} from './db';

// ------------------------------------------------------------
// todayLondon
// ------------------------------------------------------------

describe('todayLondon', () => {
  test('returns a YYYY-MM-DD string', () => {
    const out = todayLondon();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('matches ISO calendar date for Europe/London at runtime', () => {
    // Whatever Date.now() is, todayLondon() should agree on the calendar
    // day when viewed through en-CA's ordering. We pin the same TZ the
    // helper uses and the same Locale, then compare.
    const expected = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    expect(todayLondon()).toBe(expected);
  });
});

// ------------------------------------------------------------
// normalizeCostPence
// ------------------------------------------------------------

describe('normalizeCostPence', () => {
  test('pence-as-number passes through Math.round', () => {
    expect(normalizeCostPence(899, undefined)).toBe(899);
    expect(normalizeCostPence(899.4, undefined)).toBe(899);
    expect(normalizeCostPence(899.5, undefined)).toBe(900);
    expect(normalizeCostPence(0, undefined)).toBe(0);
  });

  test('pence-as-string coerces and rounds', () => {
    expect(normalizeCostPence('899', undefined)).toBe(899);
    expect(normalizeCostPence('899.6', undefined)).toBe(900);
    expect(normalizeCostPence('not a number', undefined)).toBeNull();
  });

  test('pounds-as-number converts to pence', () => {
    expect(normalizeCostPence(undefined, 8.99)).toBe(899);
    expect(normalizeCostPence(undefined, 12)).toBe(1200);
    expect(normalizeCostPence(undefined, 0)).toBe(0);
  });

  test('pounds-as-string converts to pence', () => {
    expect(normalizeCostPence(undefined, '8.99')).toBe(899);
    expect(normalizeCostPence(undefined, '12.5')).toBe(1250);
    expect(normalizeCostPence(undefined, '')).toBeNull();
    expect(normalizeCostPence(undefined, '   ')).toBeNull();
  });

  test('pounds takes precedence over pence when both provided', () => {
    // Real callers send one or the other, but the documented priority is
    // "pounds wins if present".
    expect(normalizeCostPence(100, 8.99)).toBe(899);
  });

  test('nullish inputs (both absent) → null', () => {
    expect(normalizeCostPence(undefined, undefined)).toBeNull();
    expect(normalizeCostPence(null, null)).toBeNull();
    expect(normalizeCostPence('', '')).toBeNull();
  });
});

// ------------------------------------------------------------
// fmtGBP
// ------------------------------------------------------------

describe('fmtGBP', () => {
  test('formats integer pence as £X.YY', () => {
    expect(fmtGBP(899)).toBe('£8.99');
    expect(fmtGBP(1200)).toBe('£12.00');
    expect(fmtGBP(0)).toBe('£0.00');
    expect(fmtGBP(5)).toBe('£0.05');
  });

  test('nullish → empty string (UI hides the cost column)', () => {
    expect(fmtGBP(null)).toBe('');
    expect(fmtGBP(undefined)).toBe('');
  });

  test('round-trips through normalizeCostPence for clean inputs', () => {
    const pence = normalizeCostPence(undefined, '17.43');
    expect(fmtGBP(pence)).toBe('£17.43');
  });
});

// ------------------------------------------------------------
// computeNextDue
// ------------------------------------------------------------

describe('computeNextDue', () => {
  test('adds days to last_done', () => {
    expect(computeNextDue('2026-01-01', 7, 'days', '2026-01-15')).toBe('2026-01-08');
  });

  test('adds weeks to last_done', () => {
    expect(computeNextDue('2026-01-01', 2, 'weeks', '2026-01-31')).toBe('2026-01-15');
  });

  test('overflows when the next month is shorter (JS Date semantics)', () => {
    // Jan 31 + 1 month: JS setUTCMonth overflows because Feb has no day 31.
    // The actual result is Mar 3, not the clamped Feb 28 you'd want for
    // "renew on the 31st of every month" semantics. That's intentional —
    // we don't lie about the underlying library's behavior in tests.
    // If we ever want clamping, change addCadence(); don't pretend here.
    expect(computeNextDue('2026-01-31', 1, 'months', '2026-02-28')).toBe('2026-03-03');
  });

  test('overflows Feb 29 + 1 non-leap year → Mar 1 (JS Date semantics)', () => {
    // 2024 is leap → Feb 29 valid. 2025 is not → setUTCFullYear overflows.
    expect(computeNextDue('2024-02-29', 1, 'years', '2025-02-28')).toBe('2025-03-01');
  });

  test('handles Feb 29 → Feb 29 when the result year is also leap', () => {
    expect(computeNextDue('2024-02-29', 4, 'years', '2028-02-29')).toBe('2028-02-29');
  });

  test('falls back to todayLocal when last_done is null', () => {
    expect(computeNextDue(null, 3, 'months', '2026-07-04')).toBe('2026-10-04');
  });

  test('falls back to wall-clock UTC ISO when neither last_done nor todayLocal supplied', () => {
    const nowUtc = new Date().toISOString().slice(0, 10);
    // Use a far-future base so addDays(1) doesn't overflow into UTC-of-tomorrow
    const out = computeNextDue(null, 0, 'days', undefined);
    expect(out).toBe(nowUtc);
  });
});
