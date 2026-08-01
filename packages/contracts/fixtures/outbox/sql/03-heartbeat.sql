-- role: sender
-- params: text, int, uuid[], timestamptz[]
-- args: 'mlain-ws-7f3a', 300, ARRAY['0192f3a0-1c2d-7e41-8b2c-3d4e5f607182']::uuid[], ARRAY['2026-08-01T00:00:00Z']::timestamptz[]
UPDATE messages m
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
FROM unnest($3::uuid[], $4::timestamptz[]) AS k(id, created_at)
WHERE m.id = k.id AND m.created_at = k.created_at
  AND m.status = 'claimed' AND m.claimed_by = $1;
