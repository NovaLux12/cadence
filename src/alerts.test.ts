import { describe, expect, test } from 'vitest';

import { formatAlert, escapeTelegramMarkdown } from './alerts';
import type { AlertCandidate } from './db';

// ------------------------------------------------------------
// escapeTelegramMarkdown
// ------------------------------------------------------------

describe('escapeTelegramMarkdown', () => {
  test('returns plain text unchanged', () => {
    expect(escapeTelegramMarkdown('Hello world')).toBe('Hello world');
    expect(escapeTelegramMarkdown('Price £17.43')).toBe('Price £17.43');
  });

  test('escapes each of the four Markdown special chars', () => {
    expect(escapeTelegramMarkdown('a*b')).toBe('a\\*b');
    expect(escapeTelegramMarkdown('a_b')).toBe('a\\_b');
    expect(escapeTelegramMarkdown('a`b')).toBe('a\\`b');
    expect(escapeTelegramMarkdown('a[b')).toBe('a\\[b');
  });

  test('escapes multiple occurrences and mixed types', () => {
    expect(escapeTelegramMarkdown('*foo_bar*')).toBe('\\*foo\\_bar\\*');
    // Note: `]` is NOT a Telegram Markdown special; only `[` is. The
    // inner `]` stays literal so the example renders as intended.
    expect(escapeTelegramMarkdown('Look: `[this]` is code')).toBe('Look: \\`\\[this]\\` is code');
  });

  test('does NOT escape non-special chars', () => {
    // Tilde, pipe, brace, etc. are not Markdown special under the legacy
    // Markdown parse mode. If we over-escape, the message becomes ugly
    // for everyone (backslashes everywhere).
    expect(escapeTelegramMarkdown('a.b')).toBe('a.b');
    expect(escapeTelegramMarkdown('a~b')).toBe('a~b');
    expect(escapeTelegramMarkdown('a|b')).toBe('a|b');
    expect(escapeTelegramMarkdown('a{b')).toBe('a{b');
    expect(escapeTelegramMarkdown('a)b')).toBe('a)b');
    expect(escapeTelegramMarkdown('a/b')).toBe('a/b');
  });

  test('empty string passes through', () => {
    expect(escapeTelegramMarkdown('')).toBe('');
  });
});

// ------------------------------------------------------------
// formatAlert
// ------------------------------------------------------------

const baseCandidate: AlertCandidate = {
  kind: 'subscription',
  id: 1,
  title: 'Apple iCloud+',
  due_date: '2026-08-01',
  days_until: 28,
  window_days: 28,
  alert_windows: '30,14,7,1',
  notes: null,
};

describe('formatAlert', () => {
  test('renders a normal subscription with a safe title', () => {
    const out = formatAlert({ ...baseCandidate, days_until: 28 });
    // Bold-wrapped title uses literal asterisks (they are the markdown,
    // not user content).
    expect(out).toContain('Subscription: *Apple iCloud+*');
    expect(out).toContain('Due: 2026-08-01');
  });

  test('escapes * inside the title so the parser doesn\'t choke', () => {
    const out = formatAlert({ ...baseCandidate, title: 'Apple *iCloud*' });
    // User's * are escaped to \*, the outer *…* stays as the bold
    // delimiter.
    expect(out).toContain('Subscription: *Apple \\*iCloud\\**');
    expect(out).not.toMatch(/\*Apple \*iCloud\*\*/);
  });

  test('escapes _ inside the title (would otherwise italicise)', () => {
    const out = formatAlert({ ...baseCandidate, title: 'note_app' });
    expect(out).toContain('*note\\_app*');
  });

  test('escapes backticks inside the title (would otherwise code-block)', () => {
    const out = formatAlert({ ...baseCandidate, title: 'a`b`c' });
    expect(out).toContain('*a\\`b\\`c*');
  });

  test('escapes [ inside the title (would otherwise try to parse a link)', () => {
    const out = formatAlert({ ...baseCandidate, title: 'foo[bar' });
    expect(out).toContain('*foo\\[bar*');
  });

  test('escapes special chars inside notes too', () => {
    const out = formatAlert({ ...baseCandidate, notes: 'starred *Item* in inbox' });
    expect(out).toContain('Notes: starred \\*Item\\* in inbox');
  });

  test('truncates long notes to 200 chars before escaping', () => {
    const long = 'a'.repeat(250);
    const out = formatAlert({ ...baseCandidate, notes: long });
    // escapeTelegramMarkdown is a no-op on 'a', so length is the test signal
    const notesLine = out.split('\n').find((l) => l.startsWith('Notes:'))!;
    expect(notesLine.length).toBe('Notes: '.length + 200);
  });

  test('omits the Notes line when notes is empty/null', () => {
    expect(formatAlert({ ...baseCandidate, notes: '' }).split('\n')).toHaveLength(2);
    expect(formatAlert({ ...baseCandidate, notes: null }).split('\n')).toHaveLength(2);
  });

  test('uses the right urgency label per window', () => {
    expect(formatAlert({ ...baseCandidate, days_until: 0 })).toContain('🚨 DUE NOW');
    expect(formatAlert({ ...baseCandidate, days_until: 1 })).toContain('⏰ Tomorrow');
    expect(formatAlert({ ...baseCandidate, days_until: 3 })).toContain('🔔 In 3 days');
    expect(formatAlert({ ...baseCandidate, days_until: 7 })).toContain('📅 In 7 days');
    expect(formatAlert({ ...baseCandidate, days_until: 30 })).toContain('🗓 In 30 days');
  });

  test('labels each kind correctly', () => {
    expect(formatAlert({ ...baseCandidate, kind: 'subscription' })).toContain('Subscription');
    expect(formatAlert({ ...baseCandidate, kind: 'reminder' })).toContain('Reminder');
    expect(formatAlert({ ...baseCandidate, kind: 'watchlist' })).toContain('Watchlist');
  });
});
