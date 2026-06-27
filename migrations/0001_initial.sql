-- Cadence — initial schema
-- All timestamps stored as ISO-8601 strings for portability.

-- =========================================================
-- Subscriptions
-- =========================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT,
  category TEXT,
  cost_pence INTEGER,
  currency TEXT DEFAULT 'GBP',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',  -- monthly | yearly | weekly | one-off
  next_due_date TEXT,                              -- ISO date 'YYYY-MM-DD'
  auto_renew INTEGER NOT NULL DEFAULT 1,           -- 0/1
  status TEXT NOT NULL DEFAULT 'active',           -- active | paused | cancelled
  alert_windows TEXT NOT NULL DEFAULT '30,14,7,1', -- CSV of days-before
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_subs_status ON subscriptions(status);
CREATE INDEX idx_subs_next_due ON subscriptions(next_due_date);

-- =========================================================
-- Cadence reminders (rotating health/vehicle/admin reminders)
-- =========================================================
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,                          -- health | vehicle | admin | personal
  cadence_value INTEGER NOT NULL DEFAULT 1,
  cadence_unit TEXT NOT NULL DEFAULT 'months', -- days | weeks | months | years
  last_done TEXT,                         -- ISO date
  next_due TEXT,                          -- ISO date (computed from last_done + cadence)
  alert_windows TEXT NOT NULL DEFAULT '30,14,7,1',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | done | snoozed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rem_status ON reminders(status);
CREATE INDEX idx_rem_next_due ON reminders(next_due);

-- =========================================================
-- Watchlist (active cases, contracts, decisions)
-- =========================================================
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,                          -- case | contract | decision | other
  status TEXT NOT NULL DEFAULT 'open',    -- open | waiting | closed
  next_action_date TEXT,                  -- ISO date
  next_action_label TEXT,
  parties TEXT,                           -- free-text
  notes TEXT,
  alert_windows TEXT NOT NULL DEFAULT '30,14,7,1',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_wl_status ON watchlist(status);
CREATE INDEX idx_wl_next_action ON watchlist(next_action_date);

-- =========================================================
-- Vehicle entries (fuel fills + charge sessions)
-- =========================================================
CREATE TABLE IF NOT EXISTS vehicle_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle TEXT NOT NULL DEFAULT 'mycar',
  entry_type TEXT NOT NULL,               -- fuel | charge
  entry_date TEXT NOT NULL,               -- ISO date
  odometer_miles INTEGER,
  kwh REAL,                               -- for charge entries
  litres REAL,                            -- for fuel entries
  cost_pence INTEGER NOT NULL,
  unit TEXT,                              -- for fuel: 'p/litre'; for charge: 'p/kWh'
  location TEXT,                          -- e.g. forecourt name or charger label
  is_home_charge INTEGER DEFAULT 0,       -- 0/1 — affects cost calc (home vs away)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_veh_date ON vehicle_entries(entry_date);
CREATE INDEX idx_veh_type ON vehicle_entries(entry_type);

-- =========================================================
-- Vehicle settings
-- =========================================================
CREATE TABLE IF NOT EXISTS vehicle_settings (
  vehicle TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reg_plate TEXT,
  fuel_type TEXT,                         -- phev | bev | ice | hybrid
  current_odo_miles INTEGER,
  battery_capacity_kwh REAL,
  home_electricity_pence_per_kwh REAL,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- Alert log (idempotency: don't re-alert the same item+window)
-- =========================================================
CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_kind TEXT NOT NULL,                -- subscription | reminder | watchlist
  item_id INTEGER NOT NULL,
  window_days INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  success INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_alert_unique ON alert_log(item_kind, item_id, window_days, sent_at);

-- =========================================================
-- Schema version
-- =========================================================
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_meta (key, value) VALUES ('version', '1')
ON CONFLICT(key) DO NOTHING;