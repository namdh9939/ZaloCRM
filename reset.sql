UPDATE contacts SET status = null WHERE status != 'converted';
UPDATE contacts SET status = null WHERE is_group = true;
INSERT INTO app_settings (id, org_id, setting_key, value_plain, created_at, updated_at)
SELECT gen_random_uuid(), id, 'ai_auto_apply_status', 'true', now(), now() FROM organizations
ON CONFLICT (org_id, setting_key) DO UPDATE SET value_plain = 'true';
