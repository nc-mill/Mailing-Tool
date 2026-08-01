-- role: sender
-- params: text, int, int, uuid
-- args: 'mlain-ws-7f3a', 100, 300, '0192f3a0-1c2d-7e44-9e5f-60718293a4b5'
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  WHERE m.campaign_id = $4
    AND m.status = 'pending'
    AND m.next_attempt_at <= now()
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED
)
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl, campaigns c, workspaces w
WHERE m.id         = cl.id
  AND m.created_at = cl.created_at
  AND m.campaign_id IS NOT NULL
  AND c.id         = m.campaign_id
  AND w.id         = m.workspace_id
  AND c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts;
