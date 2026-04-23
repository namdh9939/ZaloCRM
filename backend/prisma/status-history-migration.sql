-- Add lostReason + lostNote columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lost_note TEXT;

-- Create status history table
CREATE TABLE IF NOT EXISTS contact_status_history (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  changed_by_user_id TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS contact_status_history_contact_id_changed_at_idx ON contact_status_history(contact_id, changed_at);
CREATE INDEX IF NOT EXISTS contact_status_history_org_id_to_status_changed_at_idx ON contact_status_history(org_id, to_status, changed_at);

-- Backfill: create 1 initial history row per existing contact (fromStatus=null → toStatus=current)
-- Use created_at so stage-time calculation for "Mới" contacts is correct from day 1.
INSERT INTO contact_status_history (id, contact_id, org_id, from_status, to_status, changed_at)
SELECT
  gen_random_uuid()::text,
  c.id,
  c.org_id,
  NULL,
  COALESCE(c.status, 'new'),
  c.created_at
FROM contacts c
WHERE NOT EXISTS (
  SELECT 1 FROM contact_status_history h WHERE h.contact_id = c.id
);

-- Verify
SELECT COUNT(*) AS total_history_rows FROM contact_status_history;
SELECT to_status, COUNT(*) FROM contact_status_history GROUP BY to_status ORDER BY 2 DESC;
