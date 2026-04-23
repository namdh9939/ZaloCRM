-- Auto status rules for org — 2 rules:
-- 1) Sale nhắn tin đầu tiên cho KH "Mới" → status = "Đã liên hệ"
-- 2) KH cá nhân nhắn từ khóa mua/giá → status = "Quan tâm"
-- Both only run on 1-on-1 chats (threadType='user'), never groups.

BEGIN;

INSERT INTO automation_rules (id, org_id, name, description, trigger, conditions, actions, enabled, priority, run_count, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'ab4dd901-ae18-46d6-910b-cadb740eec99',
  'Auto: Mới → Đã liên hệ',
  'Khi sale nhắn tin đầu tiên cho KH đang ở trạng thái Mới (chỉ áp dụng chat cá nhân)',
  'message_received',
  '[
    {"field": "conversation.threadType", "op": "eq", "value": "user"},
    {"field": "message.senderType", "op": "eq", "value": "self"},
    {"field": "contact.status", "op": "eq", "value": "new"}
  ]'::jsonb,
  '[
    {"type": "update_status", "status": "contacted"}
  ]'::jsonb,
  true,
  100,
  0,
  NOW(),
  NOW()
);

INSERT INTO automation_rules (id, org_id, name, description, trigger, conditions, actions, enabled, priority, run_count, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'ab4dd901-ae18-46d6-910b-cadb740eec99',
  'Auto: Hỏi giá/tư vấn → Quan tâm',
  'Khi KH cá nhân nhắn từ khóa mua/giá/tư vấn/báo giá → nâng status lên Quan tâm',
  'message_received',
  '[
    {"field": "conversation.threadType", "op": "eq", "value": "user"},
    {"field": "message.senderType", "op": "eq", "value": "contact"},
    {"field": "contact.status", "op": "in", "value": ["new", "contacted"]},
    {"field": "message.content", "op": "contains_any", "value": [
      "giá",
      "bao nhiêu",
      "bao nhiu",
      "tư vấn",
      "tu van",
      "xem được",
      "xem duoc",
      "báo giá",
      "bao gia",
      "phí",
      "chi phí",
      "chi phi",
      "hợp đồng",
      "hop dong",
      "ký hợp đồng",
      "đăng ký",
      "dang ky",
      "mua",
      "đặt mua",
      "dat mua",
      "giá thế nào"
    ]}
  ]'::jsonb,
  '[
    {"type": "update_status", "status": "interested"}
  ]'::jsonb,
  true,
  90,
  0,
  NOW(),
  NOW()
);

COMMIT;

-- Verify
SELECT name, trigger, enabled, priority FROM automation_rules WHERE org_id = 'ab4dd901-ae18-46d6-910b-cadb740eec99' ORDER BY priority DESC;
