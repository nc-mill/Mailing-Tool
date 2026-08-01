-- role: sender
-- params: uuid, text, bytea[]
-- args: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', 'jana@example.cz', ARRAY['\x0011'::bytea]
SELECT 1 FROM suppressions
WHERE workspace_id = $1
  AND removed_at IS NULL
  AND (email = $2 OR fingerprint = ANY($3))
LIMIT 1;
