UPDATE contacts SET status = 'new' 
WHERE id IN (SELECT contact_id FROM conversations WHERE last_message_at >= '2026-04-30T00:01:00Z') 
AND is_group = false 
AND (status IS NULL OR status = '');
