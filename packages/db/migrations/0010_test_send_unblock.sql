-- Odblokování testovacího odeslání a skryté systémové kampaně.
--
-- PROČ TAHLE MIGRACE EXISTUJE. Go sender testovací odeslání UŽ UMÍ:
-- `StmtClaimTestBatch` v `apps/sender/internal/outbox/statements.go` claimuje
-- zprávy s `kind = 'test'` napříč kampaněmi, každý tick hlavní smyčky, a
-- schválně nekontroluje stav kampaně, aby test fungoval i z draftu. Claimuje
-- ale JEN zprávy s `campaign_id IS NOT NULL`, protože obsah (předmět, odesílatel,
-- compiled_html) čte z hlavičky kampaně a odjinud ho vzít nemá.
--
-- Databáze mu v tom bránila. Cizí klíč z migrace 0003 zněl
--
--   FOREIGN KEY (campaign_id, created_at) REFERENCES campaigns (id, audience_built_at)
--
-- a byl napsaný za předpokladu, který komentář u něj říká doslova: „zprávy
-- s campaign_id IS NULL (testovací odeslání) cizí klíč nekontroluje". Ten
-- předpoklad je nepravdivý, protože sender u testovací zprávy `campaign_id`
-- VYŽADUJE. Kampaň bez materializovaného publika má `audience_built_at = NULL`,
-- takže na ni žádná testovací zpráva nešla vložit. Naměřeno spuštěním proti
-- PostgreSQL 18:
--
--   SQLSTATE: 23503
--   insert or update on table "messages_y2026m08" violates foreign key
--   constraint "fk_messages__campaign_audience"
--
-- Sender a databáze se tedy NErozcházejí kvůli téhle migraci, rozcházely se
-- před ní. Tahle je sbližuje.
--
-- Plán P13 vadu zná a vede ji jako požadavek R-P03.7; první dva bloky jsou
-- doslova jeho znění. Třetí blok je nález navíc, který R-P03.7 nepokrývá.
--
-- Kontrakt 4.10.1 povoluje přidávat sloupce a indexy, omezení ne. Změna
-- omezení je tady VĚDOMÁ a schválená, protože bez ní zůstává hotová funkce
-- senderu trvale nedostupná.

-- ---------------------------------------------------------------------------
-- 1. R-P03.7: cizí klíč platí jen pro kampaňové zprávy
--
-- Generovaný sloupec je pro `kind = 'test'` NULL, takže se u testovací zprávy
-- kontrola podle MATCH SIMPLE přeskočí. Invariant I1 zůstává pro
-- `kind = 'campaign'` nedotčený: tam je hodnota rovná `campaign_id` a cizí klíč
-- se chová přesně jako dřív, včetně toho, že kampaňová zpráva bez materializace
-- pořád skončí chybou 23503.
-- ---------------------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS audience_campaign_id uuid
  GENERATED ALWAYS AS (CASE WHEN kind = 'campaign' THEN campaign_id END) STORED;
--> statement-breakpoint
ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages__campaign_audience;
--> statement-breakpoint
ALTER TABLE messages
  ADD CONSTRAINT fk_messages__campaign_audience
  FOREIGN KEY (audience_campaign_id, created_at)
  REFERENCES campaigns (id, audience_built_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Deduplikace publika se týká jen kampaňových zpráv
--
-- NÁLEZ NAD RÁMEC R-P03.7. Index `uq_messages__campaign_contact` byl úplný,
-- tedy platil i na testovací zprávy. Ty mají jeden dohledaný `contact_id`
-- (sloupec je NOT NULL) a jedno `created_at`, takže DRUHÁ adresa téhož
-- testovacího odeslání skončila na 23505, a to i po opravě cizího klíče.
-- Požadavek P08-R5 přitom počítá s 1 až 5 adresami najednou a P13 má vlastní
-- test „opakovaný test na tutéž adresu projde, neporuší unikátní index".
--
-- Částečnost index neoslabuje: deduplikace publika je o kampaňových zprávách
-- a pro ně platí beze změny. Ověřeno spuštěním, že partitionovaná tabulka
-- částečný unikátní index přijme.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_messages__campaign_contact;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at)
  WHERE kind = 'campaign';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Skrytá systémová kampaň
--
-- Testovací odeslání šablony potřebuje kampaň, protože z ní sender čte obsah.
-- Taková kampaň ale není nic, co by uživatel založil, a nesmí se mu objevit
-- v seznamu kampaní, v postupu onboardingu ani v reportech.
--
-- Rozlišuje se sloupcem, ne jménem. Je to týž vzor, jaký plán P13 zvolil
-- rozhodnutím D1 pro `messages.kind`, a se stejným zdůvodněním: filtr podle
-- jména nebo podle `template_id` by musel být v každém dotazu a stačí ho
-- v jednom z deseti vynechat.
--
-- Výčet je otevřený směrem nahoru, ale kontrola ho drží uzavřený: nová hodnota
-- znamená vědomou změnu tohohle omezení, ne překlep v aplikaci.
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'campaign';
--> statement-breakpoint
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS ck_campaigns__kind;
--> statement-breakpoint
ALTER TABLE campaigns
  ADD CONSTRAINT ck_campaigns__kind CHECK (kind IN ('campaign','system'));
--> statement-breakpoint

-- Skryté kampaně se hledají podle projektu a šablony, uživatelské podle stavu.
-- Bez částečného indexu by dohledání skryté kampaně šablony skenovalo všechny
-- kampaně projektu.
CREATE INDEX IF NOT EXISTS idx_campaigns__system_template
  ON campaigns (workspace_id, template_id)
  WHERE kind = 'system' AND deleted_at IS NULL;
