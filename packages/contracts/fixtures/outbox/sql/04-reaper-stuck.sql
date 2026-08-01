-- role: sender
-- params:
-- args:
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claim_expires_at < now()
  AND dispatch_started_at IS NULL
RETURNING id;
