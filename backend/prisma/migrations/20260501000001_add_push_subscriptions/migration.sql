-- Migration: add_push_subscriptions
-- Lưu Web Push subscription của từng user/thiết bị

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "org_id"      TEXT        NOT NULL,
  "user_id"     TEXT        NOT NULL,
  "endpoint"    TEXT        NOT NULL,
  "p256dh"      TEXT        NOT NULL,
  "auth"        TEXT        NOT NULL,
  "user_agent"  TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint"),
  CONSTRAINT "push_subscriptions_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_org_id_user_id_idx"
  ON "push_subscriptions"("org_id", "user_id");
