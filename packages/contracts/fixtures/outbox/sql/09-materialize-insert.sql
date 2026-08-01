-- role: app
-- params: uuid, uuid, uuid, uuid, text, jsonb, timestamptz
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', '0192f3a0-1c2d-7e44-9e5f-60718293a4b5', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4', 'jana@example.cz', '{}'::jsonb, '2026-08-01T10:00:00Z'
INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, render_data, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING;
