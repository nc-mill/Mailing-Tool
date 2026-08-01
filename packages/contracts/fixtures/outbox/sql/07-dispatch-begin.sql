-- role: sender
-- params: uuid, timestamptz, text
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '2026-08-01T00:00:00Z', 'mlain-ws-7f3a'
UPDATE messages
SET attempts = attempts + 1, dispatch_started_at = now(), updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3;
