-- One-time cleanup: dedupe contacts by (org_id, zalo_uid), add is_group column.

BEGIN;

-- 1) Build merge map: for each (org_id, zalo_uid) keep the earliest-created contact id.
CREATE TEMP TABLE contact_merge_map ON COMMIT DROP AS
SELECT
  c.id AS old_id,
  FIRST_VALUE(c.id) OVER (
    PARTITION BY c.org_id, c.zalo_uid
    ORDER BY c.created_at ASC, c.id ASC
  ) AS new_id
FROM contacts c
WHERE c.zalo_uid IS NOT NULL;

-- 2) Redirect foreign references on duplicates to the keeper.
UPDATE conversations cv
SET contact_id = m.new_id
FROM contact_merge_map m
WHERE cv.contact_id = m.old_id AND m.old_id <> m.new_id;

UPDATE appointments a
SET contact_id = m.new_id
FROM contact_merge_map m
WHERE a.contact_id = m.old_id AND m.old_id <> m.new_id;

-- Clear self-merged_into so we can delete safely
UPDATE contacts c
SET merged_into = NULL
FROM contact_merge_map m
WHERE c.merged_into = m.old_id AND m.old_id <> m.new_id;

-- 3) Delete duplicate contacts (not keepers).
DELETE FROM contacts
WHERE id IN (
  SELECT old_id FROM contact_merge_map WHERE old_id <> new_id
);

-- 4) Add is_group column + backfill.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false;
UPDATE contacts SET is_group = (COALESCE(metadata->>'isGroup', 'false') = 'true');

-- 5) Add unique index preventing future duplicates (WHERE zalo_uid IS NOT NULL to allow manual contacts without UID).
DROP INDEX IF EXISTS contacts_org_zaloUid_unique;
CREATE UNIQUE INDEX contacts_org_zaloUid_unique
  ON contacts(org_id, zalo_uid)
  WHERE zalo_uid IS NOT NULL;

-- 6) Supporting indexes.
CREATE INDEX IF NOT EXISTS contacts_org_id_is_group_idx ON contacts(org_id, is_group);

COMMIT;
