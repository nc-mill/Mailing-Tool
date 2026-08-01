-- role: sender
-- params: uuid, timestamptz, text, text
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '2026-08-01T00:00:00Z', 'mlain-ws-7f3a', '0100018f-provider'
UPDATE messages
SET status = 'sent', provider_message_id = $4, sent_at = now(),
    dispatch_started_at = NULL, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3;
