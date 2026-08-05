-- role: app
-- params: uuid, uuid, uuid, uuid, text, jsonb, timestamptz
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', '0192f3a0-1c2d-7e44-9e5f-60718293a4b5', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4', 'jana@example.cz', '{}'::jsonb, '2026-08-01T10:00:00Z'
INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, render_data, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
-- Predikát `WHERE kind = 'campaign'` je POVINNÝ, ne ozdoba. Od migrace
-- 0010_test_send_unblock je `uq_messages__campaign_contact` ČÁSTEČNÝ index
-- (`WHERE kind = 'campaign'`), a částečný index Postgres jako arbitra
-- ON CONFLICT neodvodí, dokud se týž predikát neuvede i tady. Bez něj skončí
-- příkaz chybou 42P10 „there is no unique or exclusion constraint matching the
-- ON CONFLICT specification" a materializace publika neproběhne vůbec.
--
-- Produkční dotaz to tak dělá (`campaigns/repo/outbox.ts`); tahle fixture
-- zůstala popisovat stav před migrací 0010 a kvůli tomu padaly dva testy
-- v `packages/db/test/contract-sql.test.ts`.
ON CONFLICT (campaign_id, contact_id, created_at) WHERE kind = 'campaign' DO NOTHING;
