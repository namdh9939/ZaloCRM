-- Migration: add_service_score
-- Thêm cột Điểm Phục Vụ (Service Quality Score) vào conversations và contacts

-- ── conversations ────────────────────────────────────────────────────────────
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "service_score"          INTEGER,
  ADD COLUMN IF NOT EXISTS "service_label"          TEXT,
  ADD COLUMN IF NOT EXISTS "service_score_data"     JSONB,
  ADD COLUMN IF NOT EXISTS "service_score_at"       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "manager_action_required" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "conversations_org_id_service_label_manager_action_required_idx"
  ON "conversations"("org_id", "service_label", "manager_action_required");

-- ── contacts ─────────────────────────────────────────────────────────────────
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "service_score"  INTEGER,
  ADD COLUMN IF NOT EXISTS "service_label"  TEXT;
