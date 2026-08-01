-- role: sender
-- params: text
-- args: 'mlain-ws-7f3a'
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1 AND dispatch_started_at IS NULL;
