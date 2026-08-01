-- role: sender
-- params: text, int
-- args: 'retry', 300
UPDATE messages
SET ambiguous_count = ambiguous_count + 1,
    status = CASE
               WHEN $1 = 'retry' AND ambiguous_count = 0 THEN 'pending'
               ELSE 'failed'
             END,
    error_code          = 'ambiguous_dispatch',
    claimed_by          = NULL, claimed_at = NULL, claim_expires_at = NULL,
    dispatch_started_at = NULL,
    next_attempt_at     = now(),
    updated_at          = now()
WHERE status = 'claimed'
  AND claim_expires_at < now() - make_interval(secs => $2)
  AND dispatch_started_at IS NOT NULL
  AND provider_message_id IS NULL
RETURNING id, created_at, ambiguous_count;
