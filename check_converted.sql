SELECT full_name, status, converted_at 
FROM contacts 
WHERE status = 'converted' 
ORDER BY updated_at DESC 
LIMIT 10;
