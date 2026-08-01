-- role: sender
-- params:
-- args:
SELECT c.id
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
ORDER BY c.scheduled_at NULLS FIRST, c.id;
