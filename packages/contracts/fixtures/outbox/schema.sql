-- TOHLE NENÍ SCHÉMA PRODUKTU.
-- Je to kontraktní podmnožina podle části 1, kapitoly 4.10.1, sloužící výhradně
-- k tomu, aby scénář OB-00 a scénáře OB-xx s runnerem "contracts" měly proti
-- čemu běžet už ve vlně 0, tedy dřív, než v P03 vzniknou migrace.
-- Produkční schéma vlastní packages/db (P03). Shodu obou hlídá job
-- contracts-schema podle schema/columns.json.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Torza cizích tabulek: jen kontraktní sloupce, které sender čte nebo zapisuje.
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL DEFAULT '',
  deleted_at timestamptz
);

CREATE TABLE campaigns (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'draft',
  pause_reason      jsonb,
  scheduled_at      timestamptz,
  audience_built_at timestamptz,
  provider_id       uuid,
  compiled_html     text,
  compiled_text     text,
  subject           text,
  preheader         text,
  from_name         text,
  from_email        text,
  reply_to          text,
  track_opens       boolean NOT NULL DEFAULT true,
  track_clicks      boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz
);

CREATE TABLE suppressions (
  workspace_id       uuid NOT NULL,
  email              citext,
  fingerprint        bytea,
  fingerprint_key_id smallint,
  -- Důvod blokace. Sender ho čte kvůli transakční poště: odhlášení z marketingu
  -- ji blokovat nesmí, tvrdý odraz, stížnost a výmaz podle GDPR ano.
  reason             text NOT NULL DEFAULT 'manual',
  removed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- KONTRAKTNÍ PODMNOŽINA tabulky messages. Část 4 vlastní zbytek.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id        uuid        NOT NULL,
  campaign_id         uuid,
  content_variant_id  uuid,
  kind                text        NOT NULL DEFAULT 'campaign',
  contact_id          uuid        NOT NULL,
  email               text        NOT NULL,
  render_data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'pending',
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  attempts            smallint    NOT NULL DEFAULT 0,
  ambiguous_count     smallint    NOT NULL DEFAULT 0,
  dispatch_started_at timestamptz,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  sent_at             timestamptz,
  error_code          text,
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_messages__status
    CHECK (status IN ('pending','claimed','sent','failed','skipped')),
  CONSTRAINT ck_messages__kind
    CHECK (kind IN ('campaign','test'))
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_messages__claimable
  ON messages (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';

CREATE INDEX idx_messages__stuck
  ON messages (claim_expires_at)
  WHERE status = 'claimed';

CREATE INDEX idx_messages__campaign_status
  ON messages (campaign_id, status);

CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);

-- Partition na dva měsíce dopředu. Výchozí partition se NEZAKLÁDÁ, zápis mimo
-- rozsah má selhat hlasitě (konvence 2.1).
CREATE TABLE messages_y2026m08 PARTITION OF messages
  FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
CREATE TABLE messages_y2026m09 PARTITION OF messages
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

-- Úložné parametry nejdou nastavit na partitionované tabulce jako celku,
-- nastavují se na každé partition zvlášť.
ALTER TABLE messages_y2026m08 SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 0
);
ALTER TABLE messages_y2026m09 SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 0
);

-- ---------------------------------------------------------------------------
-- Granty senderu, doslovně podle 4.10.1.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO mlain_sender;
GRANT USAGE ON SCHEMA public TO mlain_app;

GRANT SELECT ON messages TO mlain_sender;
GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at,
              dispatch_started_at, attempts, next_attempt_at,
              provider_message_id, sent_at, error_code, error_detail,
              ambiguous_count, updated_at)
  ON messages TO mlain_sender;
-- created_at ve výčtu SCHVÁLNĚ NENÍ, viz invariant I1.

GRANT SELECT ON campaigns TO mlain_sender;
GRANT UPDATE (status, pause_reason) ON campaigns TO mlain_sender;
GRANT SELECT ON workspaces   TO mlain_sender;
GRANT SELECT ON suppressions TO mlain_sender;

GRANT SELECT, INSERT, UPDATE ON messages, campaigns, workspaces, suppressions TO mlain_app;

-- ---------------------------------------------------------------------------
-- RLS a permisivní politika senderu. Bez ní vrací claim nula řádků VŽDY.
-- ---------------------------------------------------------------------------
ALTER TABLE messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sender_bypass ON messages     TO mlain_sender USING (true) WITH CHECK (true);
CREATE POLICY sender_bypass ON campaigns    TO mlain_sender USING (true);
CREATE POLICY sender_bypass ON workspaces   TO mlain_sender USING (true);
CREATE POLICY sender_bypass ON suppressions TO mlain_sender USING (true);

-- Aplikační role tady nemá izolační politiku ws_isolation, protože tu vlastní
-- P03 a kontrakt na ni nesahá. Bootstrap jí dává permisivní politiku, aby šly
-- připravit vstupní data scénářů.
CREATE POLICY app_all ON messages     TO mlain_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON campaigns    TO mlain_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON workspaces   TO mlain_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON suppressions TO mlain_app USING (true) WITH CHECK (true);
