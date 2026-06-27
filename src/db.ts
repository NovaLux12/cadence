// Cadence — D1 query helpers
import type {
  Env,
  Subscription,
  Reminder,
  WatchlistItem,
  VehicleEntry,
  VehicleSettings,
  DashboardRow,
} from './types';

// =========================================================
// Helpers
// =========================================================

/**
 * Normalise a money value into integer pence for storage.
 * Accepts either:
 *   - cost_pence: integer (already in pence)
 *   - cost_pounds: number or string (decimal pounds; e.g. 8.99 or "8.99")
 * Returns null if neither is provided.
 */
export function normalizeCostPence(pence: unknown, pounds: unknown): number | null {
  if (pounds !== undefined && pounds !== null && pounds !== '') {
    const n = typeof pounds === 'number' ? pounds : parseFloat(String(pounds));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }
  if (pence !== undefined && pence !== null && pence !== '') {
    const n = typeof pence === 'number' ? pence : Number(pence);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  }
  return null;
}

/** Format pence as £X.XX (or empty if null). */
export function fmtGBP(pence: number | null | undefined): string {
  if (pence == null) return '';
  return '£' + (pence / 100).toFixed(2);
}

// =========================================================
// Subscriptions
// =========================================================

export async function listSubscriptions(
  db: D1Database,
  opts: { status?: string } = {}
): Promise<Subscription[]> {
  let q = 'SELECT * FROM subscriptions';
  const binds: unknown[] = [];
  if (opts.status) {
    q += ' WHERE status = ?';
    binds.push(opts.status);
  }
  q += ' ORDER BY next_due_date IS NULL, next_due_date ASC, name ASC';
  const { results } = await db.prepare(q).bind(...binds).all<Subscription>();
  return results ?? [];
}

export async function getSubscription(db: D1Database, id: number): Promise<Subscription | null> {
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<Subscription>();
}

export async function createSubscription(db: D1Database, s: Partial<Subscription>): Promise<Subscription> {
  const cost = normalizeCostPence(s.cost_pence, s.cost_pounds);
  const r = await db
    .prepare(
      `INSERT INTO subscriptions (name, vendor, category, cost_pence, currency, billing_cycle,
        next_due_date, auto_renew, status, alert_windows, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      s.name ?? 'Untitled',
      s.vendor ?? null,
      s.category ?? null,
      cost,
      s.currency ?? 'GBP',
      s.billing_cycle ?? 'monthly',
      s.next_due_date ?? null,
      s.auto_renew ?? 1,
      s.status ?? 'active',
      s.alert_windows ?? '30,14,7,1',
      s.notes ?? null
    )
    .first<Subscription>();
  return r!;
}

export async function updateSubscription(
  db: D1Database,
  id: number,
  patch: Partial<Subscription>
): Promise<Subscription | null> {
  const cur = await getSubscription(db, id);
  if (!cur) return null;
  const merged = {
    ...cur,
    ...patch,
    cost_pence: patch.cost_pence !== undefined || patch.cost_pounds !== undefined
      ? normalizeCostPence(patch.cost_pence, patch.cost_pounds)
      : cur.cost_pence,
    updated_at: new Date().toISOString(),
  };
  await db
    .prepare(
      `UPDATE subscriptions SET
         name=?, vendor=?, category=?, cost_pence=?, currency=?, billing_cycle=?,
         next_due_date=?, auto_renew=?, status=?, alert_windows=?, notes=?, updated_at=?
       WHERE id=?`
    )
    .bind(
      merged.name,
      merged.vendor,
      merged.category,
      merged.cost_pence,
      merged.currency,
      merged.billing_cycle,
      merged.next_due_date,
      merged.auto_renew,
      merged.status,
      merged.alert_windows,
      merged.notes,
      merged.updated_at,
      id
    )
    .run();
  return getSubscription(db, id);
}

export async function deleteSubscription(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM subscriptions WHERE id=?').bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}

// =========================================================
// Reminders
// =========================================================

function addCadence(iso: string, value: number, unit: string): string {
  const d = new Date(iso);
  switch (unit) {
    case 'days':
      d.setUTCDate(d.getUTCDate() + value);
      break;
    case 'weeks':
      d.setUTCDate(d.getUTCDate() + value * 7);
      break;
    case 'months':
      d.setUTCMonth(d.getUTCMonth() + value);
      break;
    case 'years':
      d.setUTCFullYear(d.getUTCFullYear() + value);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export function computeNextDue(lastDone: string | null, value: number, unit: string): string {
  const base = lastDone ?? new Date().toISOString().slice(0, 10);
  return addCadence(base, value, unit);
}

export async function listReminders(
  db: D1Database,
  opts: { status?: string } = {}
): Promise<Reminder[]> {
  let q = 'SELECT * FROM reminders';
  const binds: unknown[] = [];
  if (opts.status) {
    q += ' WHERE status = ?';
    binds.push(opts.status);
  }
  q += ' ORDER BY next_due IS NULL, next_due ASC, title ASC';
  const { results } = await db.prepare(q).bind(...binds).all<Reminder>();
  return results ?? [];
}

export async function getReminder(db: D1Database, id: number): Promise<Reminder | null> {
  return db.prepare('SELECT * FROM reminders WHERE id=?').bind(id).first<Reminder>();
}

export async function createReminder(db: D1Database, r: Partial<Reminder>): Promise<Reminder> {
  const next = r.next_due ?? computeNextDue(r.last_done ?? null, r.cadence_value ?? 1, r.cadence_unit ?? 'months');
  const row = await db
    .prepare(
      `INSERT INTO reminders (title, category, cadence_value, cadence_unit, last_done,
         next_due, alert_windows, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      r.title ?? 'Untitled',
      r.category ?? null,
      r.cadence_value ?? 1,
      r.cadence_unit ?? 'months',
      r.last_done ?? null,
      next,
      r.alert_windows ?? '30,14,7,1',
      r.notes ?? null,
      r.status ?? 'active'
    )
    .first<Reminder>();
  return row!;
}

export async function updateReminder(
  db: D1Database,
  id: number,
  patch: Partial<Reminder>
): Promise<Reminder | null> {
  const cur = await getReminder(db, id);
  if (!cur) return null;
  const merged: Reminder = {
    ...cur,
    ...patch,
    next_due:
      patch.last_done || patch.cadence_value || patch.cadence_unit
        ? computeNextDue(
            patch.last_done ?? cur.last_done,
            patch.cadence_value ?? cur.cadence_value,
            patch.cadence_unit ?? cur.cadence_unit
          )
        : cur.next_due,
    updated_at: new Date().toISOString(),
  };
  await db
    .prepare(
      `UPDATE reminders SET title=?, category=?, cadence_value=?, cadence_unit=?, last_done=?,
         next_due=?, alert_windows=?, notes=?, status=?, updated_at=? WHERE id=?`
    )
    .bind(
      merged.title,
      merged.category,
      merged.cadence_value,
      merged.cadence_unit,
      merged.last_done,
      merged.next_due,
      merged.alert_windows,
      merged.notes,
      merged.status,
      merged.updated_at,
      id
    )
    .run();
  return getReminder(db, id);
}

export async function markReminderDone(
  db: D1Database,
  id: number,
  doneDate?: string
): Promise<Reminder | null> {
  const cur = await getReminder(db, id);
  if (!cur) return null;
  const date = doneDate ?? new Date().toISOString().slice(0, 10);
  return updateReminder(db, id, { last_done: date, status: 'active' });
}

export async function deleteReminder(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM reminders WHERE id=?').bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}

// =========================================================
// Watchlist
// =========================================================

export async function listWatchlist(
  db: D1Database,
  opts: { status?: string } = {}
): Promise<WatchlistItem[]> {
  let q = 'SELECT * FROM watchlist';
  const binds: unknown[] = [];
  if (opts.status) {
    q += ' WHERE status = ?';
    binds.push(opts.status);
  }
  q += ' ORDER BY next_action_date IS NULL, next_action_date ASC, title ASC';
  const { results } = await db.prepare(q).bind(...binds).all<WatchlistItem>();
  return results ?? [];
}

export async function getWatchlist(db: D1Database, id: number): Promise<WatchlistItem | null> {
  return db.prepare('SELECT * FROM watchlist WHERE id=?').bind(id).first<WatchlistItem>();
}

export async function createWatchlist(db: D1Database, w: Partial<WatchlistItem>): Promise<WatchlistItem> {
  const row = await db
    .prepare(
      `INSERT INTO watchlist (title, category, status, next_action_date, next_action_label,
         parties, notes, alert_windows)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      w.title ?? 'Untitled',
      w.category ?? null,
      w.status ?? 'open',
      w.next_action_date ?? null,
      w.next_action_label ?? null,
      w.parties ?? null,
      w.notes ?? null,
      w.alert_windows ?? '30,14,7,1'
    )
    .first<WatchlistItem>();
  return row!;
}

export async function updateWatchlist(
  db: D1Database,
  id: number,
  patch: Partial<WatchlistItem>
): Promise<WatchlistItem | null> {
  const cur = await getWatchlist(db, id);
  if (!cur) return null;
  const merged: WatchlistItem = {
    ...cur,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await db
    .prepare(
      `UPDATE watchlist SET title=?, category=?, status=?, next_action_date=?, next_action_label=?,
         parties=?, notes=?, alert_windows=?, updated_at=? WHERE id=?`
    )
    .bind(
      merged.title,
      merged.category,
      merged.status,
      merged.next_action_date,
      merged.next_action_label,
      merged.parties,
      merged.notes,
      merged.alert_windows,
      merged.updated_at,
      id
    )
    .run();
  return getWatchlist(db, id);
}

export async function deleteWatchlist(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM watchlist WHERE id=?').bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}

// =========================================================
// Vehicle entries
// =========================================================

export async function listVehicleEntries(
  db: D1Database,
  opts: { vehicle?: string; since?: string; until?: string; type?: string } = {}
): Promise<VehicleEntry[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.vehicle) {
    where.push('vehicle = ?');
    binds.push(opts.vehicle);
  }
  if (opts.since) {
    where.push('entry_date >= ?');
    binds.push(opts.since);
  }
  if (opts.until) {
    where.push('entry_date <= ?');
    binds.push(opts.until);
  }
  if (opts.type) {
    where.push('entry_type = ?');
    binds.push(opts.type);
  }
  let q = 'SELECT * FROM vehicle_entries';
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY entry_date DESC, id DESC LIMIT 500';
  const { results } = await db.prepare(q).bind(...binds).all<VehicleEntry>();
  return results ?? [];
}

export async function createVehicleEntry(db: D1Database, e: Partial<VehicleEntry>): Promise<VehicleEntry> {
  const cost = normalizeCostPence(e.cost_pence, e.cost_pounds);
  const row = await db
    .prepare(
      `INSERT INTO vehicle_entries (vehicle, entry_type, entry_date, odometer_miles, miles, kwh, litres,
         cost_pence, unit, location, is_home_charge, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      e.vehicle ?? 'mycar',
      e.entry_type ?? 'fuel',
      e.entry_date ?? new Date().toISOString().slice(0, 10),
      e.odometer_miles ?? null,
      e.miles ?? null,
      e.kwh ?? null,
      e.litres ?? null,
      cost,
      e.unit ?? null,
      e.location ?? null,
      e.is_home_charge ?? 0,
      e.notes ?? null
    )
    .first<VehicleEntry>();
  return row!;
}

export async function deleteVehicleEntry(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM vehicle_entries WHERE id=?').bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function getVehicleSettings(db: D1Database, vehicle: string): Promise<VehicleSettings | null> {
  return db.prepare('SELECT * FROM vehicle_settings WHERE vehicle=?').bind(vehicle).first<VehicleSettings>();
}

export async function upsertVehicleSettings(db: D1Database, s: Partial<VehicleSettings>): Promise<VehicleSettings> {
  const cur = await getVehicleSettings(db, s.vehicle ?? 'mycar');
  if (cur) {
    const merged = { ...cur, ...s, updated_at: new Date().toISOString() };
    await db
      .prepare(
        `UPDATE vehicle_settings SET display_name=?, reg_plate=?, fuel_type=?, current_odo_miles=?,
           battery_capacity_kwh=?, home_electricity_pence_per_kwh=?, notes=?, updated_at=?
         WHERE vehicle=?`
      )
      .bind(
        merged.display_name,
        merged.reg_plate,
        merged.fuel_type,
        merged.current_odo_miles,
        merged.battery_capacity_kwh,
        merged.home_electricity_pence_per_kwh,
        merged.notes,
        merged.updated_at,
        cur.vehicle
      )
      .run();
    return (await getVehicleSettings(db, cur.vehicle))!;
  } else {
    const row = await db
      .prepare(
        `INSERT INTO vehicle_settings (vehicle, display_name, reg_plate, fuel_type, current_odo_miles,
           battery_capacity_kwh, home_electricity_pence_per_kwh, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .bind(
        s.vehicle ?? 'mycar',
        s.display_name ?? 'Untitled',
        s.reg_plate ?? null,
        s.fuel_type ?? null,
        s.current_odo_miles ?? null,
        s.battery_capacity_kwh ?? null,
        s.home_electricity_pence_per_kwh ?? null,
        s.notes ?? null
      )
      .first<VehicleSettings>();
    return row!;
  }
}

// =========================================================
// Dashboard
// =========================================================

export async function dashboard(db: D1Database, opts: { days?: number } = {}): Promise<DashboardRow[]> {
  const days = opts.days ?? 60;
  // Use a subquery to dodge SQLite's strict UNION column-naming rules around ORDER BY.
  const { results } = await db
    .prepare(
      `
      SELECT * FROM (
        SELECT 'subscription' AS kind,
               id, name AS title, vendor, category, status,
               next_due_date AS due_date, NULL AS next_action_label,
               CAST(julianday(next_due_date) - julianday(date('now')) AS INTEGER) AS days_until,
               cost_pence, billing_cycle, notes
        FROM subscriptions
        WHERE status='active'
          AND next_due_date IS NOT NULL
          AND julianday(next_due_date) - julianday(date('now')) <= ?

        UNION ALL

        SELECT 'reminder' AS kind,
               id, title, NULL AS vendor, category, status,
               next_due AS due_date, NULL AS next_action_label,
               CAST(julianday(next_due) - julianday(date('now')) AS INTEGER) AS days_until,
               NULL AS cost_pence, NULL AS billing_cycle, notes
        FROM reminders
        WHERE status='active'
          AND next_due IS NOT NULL
          AND julianday(next_due) - julianday(date('now')) <= ?

        UNION ALL

        SELECT 'watchlist' AS kind,
               id, title, NULL AS vendor, category, status,
               next_action_date AS due_date, next_action_label,
               CAST(julianday(next_action_date) - julianday(date('now')) AS INTEGER) AS days_until,
               NULL AS cost_pence, NULL AS billing_cycle, notes
        FROM watchlist
        WHERE status IN ('open','waiting')
          AND next_action_date IS NOT NULL
          AND julianday(next_action_date) - julianday(date('now')) <= ?
      )
      ORDER BY due_date ASC
      LIMIT 100
      `
    )
    .bind(days, days, days)
    .all<DashboardRow>();
  return results ?? [];
}

// =========================================================
// Alerts — find items at each alert window
// =========================================================

export interface AlertCandidate {
  kind: 'subscription' | 'reminder' | 'watchlist';
  id: number;
  title: string;
  due_date: string;
  days_until: number;
  window_days: number;
  alert_windows: string;
  notes: string | null;
}

export async function findAlertCandidates(db: D1Database, days: number): Promise<AlertCandidate[]> {
  // For each kind, find active items where due_date is within `days` from now,
  // and a matching alert_window exists. Return every (item, window) pair that matches.
  const sql = `
    WITH upcoming AS (
      SELECT 'subscription' AS kind, id, name AS title, next_due_date AS due_date,
             CAST(julianday(next_due_date) - julianday(date('now')) AS INTEGER) AS days_until,
             alert_windows, notes
      FROM subscriptions
      WHERE status='active' AND next_due_date IS NOT NULL
        AND julianday(next_due_date) - julianday(date('now')) BETWEEN 0 AND ?

      UNION ALL

      SELECT 'reminder', id, title, next_due, CAST(julianday(next_due) - julianday(date('now')) AS INTEGER),
             alert_windows, notes
      FROM reminders
      WHERE status='active' AND next_due IS NOT NULL
        AND julianday(next_due) - julianday(date('now')) BETWEEN 0 AND ?

      UNION ALL

      SELECT 'watchlist', id, title, next_action_date, CAST(julianday(next_action_date) - julianday(date('now')) AS INTEGER),
             alert_windows, notes
      FROM watchlist
      WHERE status IN ('open','waiting') AND next_action_date IS NOT NULL
        AND julianday(next_action_date) - julianday(date('now')) BETWEEN 0 AND ?
    )
    SELECT * FROM upcoming ORDER BY due_date ASC
  `;
  const { results } = await db.prepare(sql).bind(days, days, days).all<AlertCandidate>();
  const out: AlertCandidate[] = [];
  for (const r of results ?? []) {
    const windows = r.alert_windows.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    for (const w of windows) {
      // Match if days_until equals the window OR is in the window's "alert band" (w..w+0.99)
      // Effectively: alert when days_until <= w (and we haven't alerted for this window today).
      if (r.days_until <= w) out.push({ ...r, window_days: w });
    }
  }
  return out;
}

export async function alertAlreadySent(
  db: D1Database,
  kind: string,
  itemId: number,
  window: number
): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT id FROM alert_log
       WHERE item_kind=? AND item_id=? AND window_days=?
         AND date(sent_at) = date('now')
       LIMIT 1`
    )
    .bind(kind, itemId, window)
    .first();
  return !!r;
}

export async function recordAlert(
  db: D1Database,
  kind: string,
  itemId: number,
  window: number,
  success: boolean
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO alert_log (item_kind, item_id, window_days, success) VALUES (?, ?, ?, ?)`
    )
    .bind(kind, itemId, window, success ? 1 : 0)
    .run();
}

// =========================================================
// Vehicle summary
// =========================================================

export interface VehicleWindow {
  fuel_pence: number;
  fuel_litres: number;
  charge_pence: number;
  charge_kwh: number;
  home_charge_pence: number;
  home_charge_kwh: number;
  total_miles: number | null;
  total_pence: number;
  pence_per_mile: number | null;
  fuel_mpg: number | null;
}

async function vehicleWindow(db: D1Database, vehicle: string, sinceIso: string): Promise<VehicleWindow> {
  const { results } = await db
    .prepare(
      `SELECT entry_type, SUM(cost_pence) AS pence, SUM(kwh) AS kwh, SUM(litres) AS litres, SUM(miles) AS miles,
              SUM(CASE WHEN is_home_charge=1 THEN cost_pence ELSE 0 END) AS home_pence,
              SUM(CASE WHEN is_home_charge=1 THEN kwh ELSE 0 END) AS home_kwh
       FROM vehicle_entries
       WHERE vehicle=? AND entry_date >= ?
       GROUP BY entry_type`
    )
    .bind(vehicle, sinceIso)
    .all<{
      entry_type: string;
      pence: number;
      kwh: number;
      litres: number;
      miles: number;
      home_pence: number;
      home_kwh: number;
    }>();
  const fuelRow = results?.find((r) => r.entry_type === 'fuel');
  const chargeRow = results?.find((r) => r.entry_type === 'charge');
  const fuelPence = fuelRow?.pence ?? 0;
  const fuelLitres = fuelRow?.litres ?? 0;
  const fuelMiles = fuelRow?.miles ?? 0;
  const chargePence = chargeRow?.pence ?? 0;
  const chargeKwh = chargeRow?.kwh ?? 0;
  const homePence = chargeRow?.home_pence ?? 0;
  const homeKwh = chargeRow?.home_kwh ?? 0;

  // Total miles = sum of per-entry miles in window (preferred) OR odometer delta fallback.
  let miles: number | null = fuelMiles + (chargeRow?.miles ?? 0);
  if (!miles) {
    const odoRow = await db
      .prepare(
        `SELECT MIN(odometer_miles) AS lo, MAX(odometer_miles) AS hi
         FROM vehicle_entries
         WHERE vehicle=? AND entry_date >= ? AND odometer_miles IS NOT NULL`
      )
      .bind(vehicle, sinceIso)
      .first<{ lo: number; hi: number }>();
    if (odoRow?.lo != null && odoRow?.hi != null && odoRow.lo !== odoRow.hi) {
      miles = odoRow.hi - odoRow.lo;
    } else {
      miles = null;
    }
  }

  const totalPence = fuelPence + chargePence;
  const ppm = miles && miles > 0 ? totalPence / miles : null;
  // UK MPG (imperial): miles per UK gallon (4.54609 L). Fuel-only.
  const mpg = fuelLitres > 0 && fuelMiles > 0 ? fuelMiles / (fuelLitres / 4.54609) : null;

  return {
    fuel_pence: fuelPence,
    fuel_litres: fuelLitres,
    charge_pence: chargePence,
    charge_kwh: chargeKwh,
    home_charge_pence: homePence,
    home_charge_kwh: homeKwh,
    total_miles: miles,
    total_pence: totalPence,
    pence_per_mile: ppm,
    fuel_mpg: mpg,
  };
}

export async function vehicleSummary(db: D1Database, vehicle: string) {
  const settings = await getVehicleSettings(db, vehicle);
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const since90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const last30 = await vehicleWindow(db, vehicle, since30);
  // For 90d we only need totals
  const last90: VehicleWindow = (await vehicleWindow(db, vehicle, since90));
  return {
    vehicle,
    display_name: settings?.display_name ?? vehicle,
    reg_plate: settings?.reg_plate ?? null,
    current_odo_miles: settings?.current_odo_miles ?? null,
    home_electricity_pence_per_kwh: settings?.home_electricity_pence_per_kwh ?? null,
    last_30d: last30,
    last_90d: {
      fuel_pence: last90.fuel_pence,
      charge_pence: last90.charge_pence,
      total_pence: last90.total_pence,
      pence_per_mile: last90.pence_per_mile,
    },
  };
}