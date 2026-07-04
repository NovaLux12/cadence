// Cadence — global search across subscriptions, reminders, watchlist,
// and vehicle entries.
//
// One GET /api/search?q=... endpoint, four parallel LIKE queries,
// score-and-merge in JS. SQLite's default LIKE is case-insensitive
// on ASCII, so 'esso' matches 'Esso Southampton' without LOWER().

import type { D1Database } from '@cloudflare/workers-types';

// =========================================================
// Types
// =========================================================

export type SearchKind = 'subscription' | 'reminder' | 'watchlist' | 'vehicle';

export interface SearchResult {
  kind: SearchKind;
  id: number;
  title: string;
  subtitle: string | null;
  category: string | null;
  /** Generic "the date that matters for this kind" — see `date_label`. */
  date: string | null;
  /** Human label for `date`: 'Due' / 'Next action' / 'Entry date'. */
  date_label: string;
  /** Higher = more relevant match. Used for sort. */
  score: number;
}

export interface SearchOptions {
  limit?: number;
  /** If set, only search these kinds. Defaults to all four. */
  kinds?: SearchKind[];
}

// =========================================================
// Pure helpers — testable without D1
// =========================================================

/**
 * Sanitize + validate user search input. Returns null when the input is
 * too short to meaningfully search; otherwise returns the trimmed needle
 * and a LIKE pattern with `%` and `_` escaped so the user can't
 * accidentally broaden the search.
 */
export function prepareSearch(raw: string, minLength = 2): SearchInput | null {
  const trimmed = raw.trim();
  if (trimmed.length < minLength) return null;
  // Escape LIKE specials: %, _, and \ itself. The ESCAPE '\\' clause on
  // each query tells SQLite to interpret \ as the escape char.
  const escaped = trimmed.replace(/[\\%_]/g, (m) => '\\' + m);
  return {
    raw: trimmed,
    needle: trimmed.toLowerCase(),
    pattern: `%${escaped}%`,
  };
}

export interface SearchInput {
  raw: string;
  /** Lowercased trimmed needle, used for JS-side scoring. */
  needle: string;
  /** LIKE pattern with wildcards + escapes. Bind this into the SQL. */
  pattern: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Rank a candidate row against the lowercase needle.
 * Bumped score per match type:
 *   - exact match (case-insensitive): 100
 *   - word-boundary match: 80
 *   - prefix (starts with): 60
 *   - substring (anywhere): 30
 * The best score across all inspected fields wins.
 */
export function score(needle: string, ...fields: Array<string | null | undefined>): number {
  if (!needle) return 0;
  let best = 0;
  for (const f of fields) {
    if (typeof f !== 'string' || f.length === 0) continue;
    const fl = f.toLowerCase();
    if (fl === needle) return 100;
    if (fl.startsWith(needle)) best = Math.max(best, 60);
    if (fl.includes(needle)) best = Math.max(best, 30);
    try {
      if (new RegExp('\\b' + escapeRegex(needle)).test(fl)) best = Math.max(best, 80);
    } catch {
      // bad regex from user input — skip the word-boundary check
    }
  }
  return best;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =========================================================
// SQL queries
// =========================================================
//
// Each query is self-contained (LIMIT, WHERE on the requested columns).
// We issue them in parallel via Promise.all and merge in JS. This is
// cheaper than UNION ALL because (a) each table has different columns
// that need different projections, and (b) we want per-row scoring for
// relevance sorting, not a global SQL-side ranking.
//
// SQLite LIKE is case-INsensitive on ASCII by default — no LOWER() needed.

const SUBS_SQL = `
  SELECT id, name AS title, vendor AS subtitle, category, next_due_date AS date,
         next_due_date IS NULL AS date_missing
  FROM subscriptions
  WHERE status = 'active' AND (
    name     LIKE ?1 ESCAPE '\\' OR
    vendor   LIKE ?2 ESCAPE '\\' OR
    category LIKE ?3 ESCAPE '\\' OR
    notes    LIKE ?4 ESCAPE '\\'
  )
  ORDER BY name
  LIMIT ?5
`;

const REMINDERS_SQL = `
  SELECT id, title, notes, category, next_due AS date
  FROM reminders
  WHERE status != 'cancelled' AND (
    title    LIKE ?1 ESCAPE '\\' OR
    category LIKE ?2 ESCAPE '\\' OR
    notes    LIKE ?3 ESCAPE '\\'
  )
  ORDER BY next_due
  LIMIT ?4
`;

const WATCHLIST_SQL = `
  SELECT id, title, parties, notes, category, next_action_date AS date,
         next_action_label
  FROM watchlist
  WHERE status IN ('open', 'waiting') AND (
    title    LIKE ?1 ESCAPE '\\' OR
    category LIKE ?2 ESCAPE '\\' OR
    parties  LIKE ?3 ESCAPE '\\' OR
    notes    LIKE ?4 ESCAPE '\\'
  )
  ORDER BY next_action_date
  LIMIT ?5
`;

const VEHICLE_SQL = `
  SELECT id, entry_type, location, notes, entry_date AS date
  FROM vehicle_entries
  WHERE ignored = 0 AND (
    location LIKE ?1 ESCAPE '\\' OR
    notes    LIKE ?2 ESCAPE '\\'
  )
  ORDER BY entry_date DESC
  LIMIT ?3
`;

// =========================================================
// searchAll
// =========================================================

export async function searchAll(
  db: D1Database,
  raw: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const input = prepareSearch(raw);
  if (!input) return [];
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const wanted = new Set<SearchKind>(opts.kinds ?? [
    'subscription',
    'reminder',
    'watchlist',
    'vehicle',
  ]);

  // We always issue the four queries in parallel; the kind filter
  // (opts.kinds) gates which ones RETURN results at the merge step.
  // Issuing the queries regardless is fine because they're cheap
  // (indexed-ish via the WHERE clauses) and parallelising them under
  // Promise.all keeps wall-clock down.
  const { pattern } = input;
  const subsPromise = db
    .prepare(SUBS_SQL)
    .bind(pattern, pattern, pattern, pattern, limit)
    .all<SubRow>();
  const remsPromise = db
    .prepare(REMINDERS_SQL)
    .bind(pattern, pattern, pattern, limit)
    .all<ReminderRow>();
  const wlPromise = db
    .prepare(WATCHLIST_SQL)
    .bind(pattern, pattern, pattern, pattern, limit)
    .all<WatchlistRow>();
  const vehPromise = db
    .prepare(VEHICLE_SQL)
    .bind(pattern, pattern, limit)
    .all<VehicleRow>();

  const [subs, rems, wls, veh] = await Promise.all([subsPromise, remsPromise, wlPromise, vehPromise]);

  const out: SearchResult[] = [];
  if (wanted.has('subscription')) {
    for (const r of subs.results ?? []) {
      const s = score(input.needle, r.title, r.subtitle, r.category, null);
      if (s === 0) continue;
      out.push({
        kind: 'subscription',
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        category: r.category,
        date: r.date ?? null,
        date_label: 'Due',
        score: s,
      });
    }
  }
  if (wanted.has('reminder')) {
    for (const r of rems.results ?? []) {
      const s = score(input.needle, r.title, r.category, r.notes);
      if (s === 0) continue;
      out.push({
        kind: 'reminder',
        id: r.id,
        title: r.title,
        subtitle: r.notes ? r.notes.slice(0, 80) : null,
        category: r.category,
        date: r.date ?? null,
        date_label: 'Due',
        score: s,
      });
    }
  }
  if (wanted.has('watchlist')) {
    for (const r of wls.results ?? []) {
      const s = score(input.needle, r.title, r.parties, r.category, r.notes);
      if (s === 0) continue;
      out.push({
        kind: 'watchlist',
        id: r.id,
        title: r.title,
        subtitle: r.next_action_label ?? (r.parties ? `Parties: ${r.parties}` : null),
        category: r.category,
        date: r.date ?? null,
        date_label: 'Next action',
        score: s,
      });
    }
  }
  if (wanted.has('vehicle')) {
    for (const r of veh.results ?? []) {
      const s = score(input.needle, r.location, r.notes);
      if (s === 0) continue;
      out.push({
        kind: 'vehicle',
        id: r.id,
        title: r.location ? `${r.location}` : `${r.entry_type} entry #${r.id}`,
        subtitle: r.notes ? r.notes.slice(0, 80) : null,
        category: r.entry_type,
        date: r.date ?? null,
        date_label: 'Entry date',
        score: s,
      });
    }
  }

  // Score desc, then by kind for stable ordering, then title alpha.
  out.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  return out.slice(0, limit);
}

// =========================================================
// Row shapes (private — only the search layer needs these)
// =========================================================

interface SubRow {
  id: number;
  title: string;
  subtitle: string | null;
  category: string | null;
  date: string | null;
  date_missing?: number;
}

interface ReminderRow {
  id: number;
  title: string;
  notes: string | null;
  category: string | null;
  date: string | null;
}

interface WatchlistRow {
  id: number;
  title: string;
  parties: string | null;
  notes: string | null;
  category: string | null;
  date: string | null;
  next_action_label: string | null;
}

interface VehicleRow {
  id: number;
  entry_type: string;
  location: string | null;
  notes: string | null;
  date: string | null;
}
