SELECT za.id, za.display_name, COUNT(DISTINCT c.id) 
FROM zalo_accounts za
LEFT JOIN conversations conv ON conv.zalo_account_id = za.id AND conv.thread_type = 'user'
LEFT JOIN contacts c ON c.id = conv.contact_id 
WHERE c.status IS NOT NULL 
  AND (c.created_at >= '2026-04-26' OR conv.last_message_at >= '2026-04-26')
GROUP BY za.id, za.display_name;
