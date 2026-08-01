-- role: sender
-- params: uuid, jsonb
-- args: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5', '{"code":"provider_quota_exhausted","source":"sender","at":"2026-07-31T14:22:31Z"}'::jsonb
UPDATE campaigns
SET status = 'paused', pause_reason = $2
WHERE id = $1 AND status IN ('queueing', 'sending');
