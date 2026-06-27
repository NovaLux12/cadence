-- Cadence migration 0003: ignored flag for bad/outlier vehicle entries
ALTER TABLE vehicle_entries ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_veh_ignored ON vehicle_entries(ignored);