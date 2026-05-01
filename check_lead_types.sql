SELECT full_name, status, contact_type, is_group 
FROM contacts 
WHERE status = 'new' 
  AND is_group = false;
