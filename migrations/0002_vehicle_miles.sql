-- Cadence migration 0002: per-entry miles (for accurate fuel/charge mpg tracking)
ALTER TABLE vehicle_entries ADD COLUMN miles REAL;