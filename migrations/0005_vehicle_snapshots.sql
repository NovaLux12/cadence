-- Cadence migration 0005: append-only telemetry log from SmartCar
-- Each row is one (vehicle, signal) sample. Numeric signals go in value_num;
-- string/enum signals (door state, lock state, etc.) go in value_text.
-- recorded_at is the signal's timestamp from SmartCar; received_at is when we wrote it.

CREATE TABLE IF NOT EXISTS vehicle_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle TEXT NOT NULL,
  signal TEXT NOT NULL,                      -- 'odometer_miles', 'fuel_level_pct', 'state_of_charge_pct', 'is_charging', etc.
  value_num REAL,                            -- numeric signal
  value_text TEXT,                           -- string/enum signal
  unit TEXT,                                 -- 'miles', '%', 'kWh', 'km', etc.
  recorded_at TEXT NOT NULL,                 -- ISO datetime — signal timestamp from SmartCar
  received_at TEXT NOT NULL DEFAULT (datetime('now')),  -- when we wrote it locally
  source TEXT NOT NULL DEFAULT 'sync'        -- sync | webhook
);

CREATE INDEX idx_vs_vehicle_signal_time ON vehicle_snapshots(vehicle, signal, recorded_at DESC);
CREATE INDEX idx_vs_recorded ON vehicle_snapshots(recorded_at);

-- Bump schema version
UPDATE schema_meta SET value = '2', updated_at = datetime('now') WHERE key = 'version';