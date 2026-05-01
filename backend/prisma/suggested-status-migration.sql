-- Add AI-suggested status fields to contacts table
-- Run via: docker exec -i zalo-crm-db psql -U $DB_USER $DB_NAME < suggested-status-migration.sql

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS suggested_status         TEXT,
  ADD COLUMN IF NOT EXISTS suggested_status_reason  TEXT,
  ADD COLUMN IF NOT EXISTS suggested_status_at      TIMESTAMP(3);

-- Index for the "show me all contacts with pending suggestions" query
CREATE INDEX IF NOT EXISTS contacts_suggested_status_idx
  ON contacts(org_id, suggested_status_at)
  WHERE suggested_status IS NOT NULL;
