// Cadence — Easee integration (live EV charging session sync)
// Public API docs: https://developer.easee.com/reference/account_authenticate
//
// Auth: POST /api/accounts/login with userName + password → access token.
// Sessions:
//   GET /api/chargers                                  → list user's chargers
//   GET /api/chargers/{id}/sessions/latest             → last completed session
//   GET /api/chargers/{id}/sessions/ongoing            → current session (if any)
//
// We use the site-owner (home/small business) public API — no partner
// integration needed.

import type { Env } from './types';
import * as db from './db';

const EASEE_BASE = 'https://api.easee.com/api';

export interface EaseeCreds {
  userName: string;
  password: string;
}

interface EaseeCharger {
  id: string;
  name?: string;
  productCode?: number;
  // ... many more fields; we only need id + name
}

interface EaseeSession {
  chargerId: string;
  sessionId: number;
  sessionStart: string;
  sessionEnd?: string;
  sessionEnergy: number; // kWh
  chargeDurationInSeconds?: number;
  costIncludingVat?: number;
  costExcludingVat?: number;
  currencyId?: string;
  pricePrKwhIncludingVat?: number;
  pricePerKwhExcludingVat?: number;
}

export async function login(env: Env): Promise<string | null> {
  const u = env.EASEE_USERNAME;
  const p = env.EASEE_PASSWORD;
  if (!u || !p) return null;
  const r = await fetch(`${EASEE_BASE}/accounts/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userName: u, password: p }),
  });
  if (!r.ok) {
    console.error('[easee] login failed', r.status, await r.text());
    return null;
  }
  const body = (await r.json()) as { accessToken?: string; access_token?: string };
  return body.accessToken ?? body.access_token ?? null;
}

async function authedGet(env: Env, path: string, token: string): Promise<Response> {
  return fetch(`${EASEE_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
}

export async function getOngoingSession(env: Env, chargerId: string, token: string): Promise<EaseeSession | null> {
  const r = await authedGet(env, `/chargers/${chargerId}/sessions/ongoing`, token);
  if (!r.ok) return null;
  const body = (await r.json()) as EaseeSession | null;
  return body && body.sessionId ? body : null;
}

/** Get live state for every charger (the charger that's currently charging, if any). */
export async function getLiveCharging(env: Env): Promise<{
  charger: EaseeCharger | null;
  session: EaseeSession | null;
  configured: boolean;
}> {
  const token = await login(env);
  if (!token) return { charger: null, session: null, configured: false };
  const chargers = await listChargers(env, token);
  for (const c of chargers) {
    const s = await getOngoingSession(env, c.id, token);
    if (s) return { charger: c, session: s, configured: true };
  }
  return { charger: null, session: null, configured: true };
}

export async function listChargers(env: Env, token: string): Promise<EaseeCharger[]> {
  const r = await authedGet(env, '/chargers', token);
  if (!r.ok) {
    console.error('[easee] list chargers failed', r.status);
    return [];
  }
  return ((await r.json()) as EaseeCharger[]) ?? [];
}

/** Get the most recent completed (or ongoing) session for a charger. */
export async function latestSession(env: Env, chargerId: string, token: string): Promise<EaseeSession | null> {
  // Try latest first, fall back to ongoing if none.
  let r = await authedGet(env, `/chargers/${chargerId}/sessions/latest`, token);
  if (!r.ok) return null;
  const latest = (await r.json()) as EaseeSession | null;
  if (latest && latest.sessionId) return latest;
  r = await authedGet(env, `/chargers/${chargerId}/sessions/ongoing`, token);
  if (!r.ok) return null;
  const ongoing = (await r.json()) as EaseeSession | null;
  return ongoing && ongoing.sessionId ? ongoing : null;
}

/** Get all completed sessions for a charger in a date range (from/to as YYYY-MM-DD). */
export async function sessionsInRange(env: Env, chargerId: string, fromIso: string, toIso: string, token: string): Promise<EaseeSession[]> {
  const r = await authedGet(env, `/sessions/charger/${chargerId}/sessions/${fromIso}/${toIso}`, token);
  if (!r.ok) {
    console.error('[easee] sessions range failed', r.status, await r.text());
    return [];
  }
  const data = (await r.json()) as any[] | null;
  if (!Array.isArray(data)) return [];
  // Normalize historical endpoint field names to canonical EaseeSession shape.
  // Historical uses: carConnected, carDisconnected, kiloWattHours, actualDurationSeconds, id
  // Latest uses:     sessionStart,    sessionEnd,        sessionEnergy,     chargeDurationInSeconds, sessionId
  return data.map((s) => ({
    chargerId: s.chargerId ?? chargerId,
    sessionId: s.sessionId ?? s.id,
    sessionStart: s.sessionStart ?? s.carConnected,
    sessionEnd: s.sessionEnd ?? s.carDisconnected,
    sessionEnergy: s.sessionEnergy ?? s.kiloWattHours ?? 0,
    chargeDurationInSeconds: s.chargeDurationInSeconds ?? s.actualDurationSeconds,
    costIncludingVat: s.costIncludingVat,
    costExcludingVat: s.costExcludingVat,
    pricePrKwhIncludingVat: s.pricePrKwhIncludingVat,
    pricePerKwhExcludingVat: s.pricePerKwhExcludingVat,
    vatPercentage: s.vatPercentage,
    currencyId: s.currencyId,
  }));
}

/**
 * Pull the latest session for every charger the user has access to and insert
 * any new ones into vehicle_entries. Idempotent: dedupes on (vehicle, session_id).
 */
export async function syncEasee(env: Env, opts: { vehicle?: string; dryRun?: boolean } = {}): Promise<{
  chargers: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const result = { chargers: 0, inserted: 0, skipped: 0, errors: [] as string[] };
  const token = await login(env);
  if (!token) {
    result.errors.push('easee credentials not configured (set EASEE_USERNAME + EASEE_PASSWORD secrets)');
    return result;
  }
  const chargers = await listChargers(env, token);
  result.chargers = chargers.length;
  for (const c of chargers) {
    const session = await latestSession(env, c.id, token);
    if (!session) continue;
    // Skip if we've already stored this session.
    const existing = await env.DB
      .prepare(`SELECT id FROM vehicle_entries WHERE vehicle=? AND notes LIKE ? LIMIT 1`)
      .bind(opts.vehicle ?? 'mycar', `easee-session-${session.sessionId}%`)
      .first<{ id: number }>();
    if (existing) {
      result.skipped++;
      continue;
    }
    if (opts.dryRun) {
      result.inserted++;
      continue;
    }
    try {
      // Cost comes from Easee as a number (currency unit). Store in pence — but Easee
      // already gives us decimal pounds (£), so divide by 100. Treat missing cost as 0.
      const costPounds = session.costIncludingVat ?? session.costExcludingVat ?? 0;
      const costPence = Math.round(costPounds * 100);
      const unit = session.pricePrKwhIncludingVat ?? session.pricePerKwhExcludingVat
        ? `p/kWh @ ${Math.round((session.pricePrKwhIncludingVat ?? session.pricePerKwhExcludingVat ?? 0) * 100)}`
        : null;
      await db.createVehicleEntry(env.DB, {
        vehicle: opts.vehicle ?? 'mycar',
        entry_type: 'charge',
        entry_date: (session.sessionEnd ?? session.sessionStart).slice(0, 10),
        kwh: session.sessionEnergy,
        cost_pounds: costPounds,
        unit,
        location: `Easee ${c.name ?? c.id}`,
        is_home_charge: 1, // home charger by default; user can edit if not
        notes: `easee-session-${session.sessionId} · ${session.chargeDurationInSeconds ?? '?'}s · ${c.name ?? c.id}`,
      });
      result.inserted++;
    } catch (err) {
      result.errors.push(`charger ${c.id}: ${String(err)}`);
    }
  }
  return result;
}

/**
 * Backfill historical Easee sessions in chunks to avoid hitting the API
 * with a giant date range. Iterates monthly chunks from `fromIso` to `toIso`.
 */
export async function backfillEasee(env: Env, opts: {
  vehicle?: string;
  fromIso?: string;     // YYYY-MM-DD; default = 6 months ago
  toIso?: string;       // YYYY-MM-DD; default = today
  dryRun?: boolean;
} = {}): Promise<{
  chargers: number;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const result = { chargers: 0, fetched: 0, inserted: 0, skipped: 0, errors: [] as string[] };
  const token = await login(env);
  if (!token) {
    result.errors.push('easee credentials not configured');
    return result;
  }
  const chargers = await listChargers(env, token);
  result.chargers = chargers.length;
  const today = new Date().toISOString().slice(0, 10);
  const toIso = opts.toIso ?? today;
  const fromIso = opts.fromIso ?? (() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 6);
    return d.toISOString().slice(0, 10);
  })();
  // Walk month by month.
  let cursor = new Date(fromIso + 'T00:00:00Z');
  const end = new Date(toIso + 'T00:00:00Z');
  while (cursor <= end) {
    const chunkStart = cursor.toISOString().slice(0, 10);
    const next = new Date(cursor);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const chunkEnd = (next > end ? end : next).toISOString().slice(0, 10);
    for (const c of chargers) {
      const sessions = await sessionsInRange(env, c.id, chunkStart, chunkEnd, token);
      result.fetched += sessions.length;
      for (const session of sessions) {
        const existing = await env.DB
          .prepare(`SELECT id FROM vehicle_entries WHERE vehicle=? AND notes LIKE ? LIMIT 1`)
          .bind(opts.vehicle ?? 'mycar', `easee-session-${session.sessionId}%`)
          .first<{ id: number }>();
        if (existing) {
          result.skipped++;
          continue;
        }
        if (opts.dryRun) {
          result.inserted++;
          continue;
        }
        try {
          const costPounds = session.costIncludingVat ?? session.costExcludingVat ?? 0;
          const unit = session.pricePrKwhIncludingVat ?? session.pricePerKwhExcludingVat
            ? `p/kWh @ ${Math.round((session.pricePrKwhIncludingVat ?? session.pricePerKwhExcludingVat ?? 0) * 100)}`
            : null;
          await db.createVehicleEntry(env.DB, {
            vehicle: opts.vehicle ?? 'mycar',
            entry_type: 'charge',
            entry_date: (session.sessionEnd ?? session.sessionStart).slice(0, 10),
            kwh: session.sessionEnergy,
            cost_pounds: costPounds,
            unit,
            location: `Easee ${c.name ?? c.id}`,
            is_home_charge: 1,
            notes: `easee-session-${session.sessionId} · ${session.chargeDurationInSeconds ?? '?'}s · ${c.name ?? c.id}`,
          });
          result.inserted++;
        } catch (err) {
          result.errors.push(`session ${session.sessionId}: ${String(err)}`);
        }
      }
    }
    cursor = next;
  }
  return result;
}