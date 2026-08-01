-- mlain:timeout=300

-- ---------------------------------------------------------------------------
-- audit_log: append only, partitionovaný po měsících.
-- workspace_id je NULLABLE schválně: globální akce (přihlášení, změna hesla)
-- k žádnému projektu nepatří. Politika ws_isolation_audit z migrace 0004 na to
-- navazuje a bez ní by INSERT globálního záznamu shodil celou transakci.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            uuid NOT NULL DEFAULT uuidv7(),
  workspace_id  uuid,
  actor_type    text NOT NULL,
  actor_id      uuid,
  actor_label   text NOT NULL DEFAULT '',
  action        text NOT NULL,
  target_type   text,
  target_id     uuid,
  ip            inet,
  user_agent    text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_audit_log__actor_type CHECK (actor_type IN ('user','api_key','system'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
-- Hlavní pohled: audit jednoho projektu v čase, nejnovější první.
CREATE INDEX idx_audit_log__ws_created ON audit_log (workspace_id, created_at DESC);
--> statement-breakpoint
-- Dohledání "co dělal tenhle aktér".
CREATE INDEX idx_audit_log__actor ON audit_log (actor_type, actor_id, created_at DESC);
--> statement-breakpoint

CREATE TABLE webhook_events (
  id           uuid NOT NULL DEFAULT uuidv7(),
  workspace_id uuid NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX idx_webhook_events__ws_created ON webhook_events (workspace_id, created_at DESC);
--> statement-breakpoint

CREATE TABLE webhook_deliveries (
  id                    uuid NOT NULL DEFAULT uuidv7(),
  workspace_id          uuid NOT NULL,
  endpoint_id           uuid NOT NULL,
  event_id              uuid NOT NULL,
  event_type            text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  attempt               integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  response_status       integer,
  response_body_snippet text,
  duration_ms           integer,
  error_code            text,
  delivered_at          timestamptz,
  -- Partiční klíč A ZÁROVEŇ druhá složka klíče události. DEFAULT now() tu
  -- SCHVÁLNĚ není: hodnota se přebírá z webhook_events.created_at.
  created_at            timestamptz NOT NULL,
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_webhook_deliveries__status
    CHECK (status IN ('pending','delivering','succeeded','failed','abandoned'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliveries__endpoint
  ON webhook_deliveries (endpoint_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliveries__event ON webhook_deliveries (event_id);
--> statement-breakpoint
-- Idempotence fan-outu. created_at v indexu je VYNUCENÉ: unikátní index na
-- partitionované tabulce musí obsahovat partiční klíč, takže (event_id, endpoint_id)
-- samo o sobě nejde vytvořit.
--
-- Index chrání POUZE proto, že created_at je deterministické (kopie
-- webhook_events.created_at, viz rozhodnutí R22). S DEFAULT now() by dva
-- fan-outy téže události prošly oba a příjemce by dostal webhook dvakrát.
-- Registr UNIQUE_INDEX_EXCEPTIONS v src/partitions.ts tenhle index vyjmenovává
-- i s důvodem a katalogový test v grants.test.ts to porovnává se skutečností.
CREATE UNIQUE INDEX uq_webhook_deliveries__event_endpoint
  ON webhook_deliveries (event_id, endpoint_id, created_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- messages: OUTBOX. Kontraktní podmnožinu vlastní zmrazený kontrakt
-- (část 1, 4.10.1). Název, typ ani sémantika kontraktního sloupce se NESMÍ
-- změnit. Přidávat sloupce a indexy dovoleno je.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id        uuid        NOT NULL,
  campaign_id         uuid,       -- NULL = nekampáňová zpráva, rezerva pro MVP 1
  content_variant_id  uuid,       -- NULL = obsah ze sloupců kampaně, rezerva pro MVP 1
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
  -- ck_messages__attempts ani ck_messages__sent_has_timestamp tu SCHVÁLNĚ
  -- NEJSOU (rozhodnutí R29). Kontrakt 4.10.1 povoluje přidávat sloupce
  -- a indexy, omezení ne. Cesta, která nastaví status bez časového razítka,
  -- by skončila chybou 23514 uvnitř senderu, tedy tvrdým selháním v běhu,
  -- kvůli kterému se kontrakt mrazí.
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
-- Rezerva pro A/B test obsahu. Partitionovaná tabulka smí mít odchozí cizí klíč.
ALTER TABLE messages
  ADD CONSTRAINT fk_messages__campaign_content_variants
  FOREIGN KEY (content_variant_id)
  REFERENCES campaign_content_variants(id) ON DELETE SET NULL;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- INVARIANT I1 SE VYNUCUJE ZDE (rozhodnutí R24), ne dokumentací.
--
-- uq_messages__campaign_contact obsahuje created_at, protože partiční klíč
-- v unikátním indexu být musí. Sám o sobě proto proti duplicitám NECHRÁNÍ:
-- messages.created_at má DEFAULT now(), takže první cesta, která zprávu vloží
-- bez explicitního created_at, index obejde a KONTAKT DOSTANE E-MAIL DVAKRÁT.
-- Nic přitom nespadne.
--
-- Složený cizí klíč to mění v tvrdou chybu 23503: zpráva smí existovat jen
-- s created_at rovným audience_built_at své kampaně. Ověřeno spuštěním na
-- PostgreSQL 18, včetně toho, že zápis s DEFAULT now() selže a že zprávy
-- s campaign_id IS NULL (testovací odeslání) cizí klíč nekontroluje.
--
-- audience_built_at je nullable, takže kampaň bez materializace nemůže být
-- cílem odkazu a zpráva k ní nevznikne. To je záměr, ne vedlejší účinek.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_campaigns__id_audience_built_at
  ON campaigns (id, audience_built_at);
--> statement-breakpoint
ALTER TABLE messages
  ADD CONSTRAINT fk_messages__campaign_audience
  FOREIGN KEY (campaign_id, created_at)
  REFERENCES campaigns (id, audience_built_at);
--> statement-breakpoint
-- Claim dotaz senderu. campaign_id je první sloupec SCHVÁLNĚ: claim vždy běží
-- v rámci konkrétní běžící kampaně. Index (next_attempt_at, id) BEZ campaign_id
-- by znamenal, že pozastavená kampaň na 500 tisíc příjemců má nejstarší časy,
-- řadí se první, a každý claim jakékoliv jiné kampaně by musel projít
-- a zamknout jejích 500 tisíc řádků, než je join zahodí. Dvakrát za sekundu
-- na každý běžící sender.
CREATE INDEX idx_messages__claimable
  ON messages (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';
--> statement-breakpoint
-- Reaper hledá zaseknuté claimy. Částečný index drží velikost v jednotkách řádků.
CREATE INDEX idx_messages__stuck ON messages (claim_expires_at) WHERE status = 'claimed';
--> statement-breakpoint
CREATE INDEX idx_messages__campaign_status ON messages (campaign_id, status);
--> statement-breakpoint
-- Deduplikace publika. created_at v indexu je VYNUCENÉ. Sám o sobě index
-- ochranu proti duplicitám NEDÁVÁ, dává ji až ve spojení s invariantem I1:
-- všechny řádky jednoho materializačního běhu mají created_at rovné
-- campaigns.audience_built_at.
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);
--> statement-breakpoint
-- Testovací odeslání se claimuje napříč kampaněmi a má přednost. Bez vlastního
-- indexu by test čekal za probíhající kampaní.
CREATE INDEX idx_messages__test_claimable ON messages (next_attempt_at)
  WHERE status = 'pending' AND kind = 'test';
--> statement-breakpoint
-- Párování příchozích událostí od providera na zprávu.
CREATE INDEX idx_messages__provider_message_id ON messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
--> statement-breakpoint
-- Recovery pass při startu senderu a uvolnění zbytku dávky při shutdownu.
CREATE INDEX idx_messages__claimed_by ON messages (claimed_by) WHERE status = 'claimed';
--> statement-breakpoint
-- Vyškrtnutí pending zpráv při odhlášení nebo suppression konkrétní adresy.
-- Bez něj by odhlášení jednoho člověka skenovalo celou kampaň.
CREATE INDEX idx_messages__ws_email_pending ON messages (workspace_id, lower(email))
  WHERE status = 'pending';
--> statement-breakpoint
-- Přírůstkové čtení průběhu odesílání podle vodoznaku. Bez něj by se muselo
-- vrátit k událostem typu 'sent', tedy k milionu zápisů navíc na kampaň.
CREATE INDEX idx_messages__campaign_sent_at ON messages (campaign_id, sent_at)
  WHERE sent_at IS NOT NULL;
--> statement-breakpoint
-- Timeline kontaktu: "které kampaně dostal" napříč kampaněmi. Dnešní
-- uq_messages__campaign_contact je vedený od campaign_id, takže na tenhle
-- dotaz neodpoví, a GDPR výmaz i export dat subjektu by bez něj procházely
-- celou tabulku.
CREATE INDEX idx_messages__contact ON messages (workspace_id, contact_id, created_at DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- message_events: append only. Partiční klíč je received_at, NE ts.
-- ts je hodnota od providera a nemáme nad ní kontrolu: SES pošle zpožděný bounce
-- s časovou značkou mimo existující okno, a protože výchozí partition
-- nezakládáme, zápis by TVRDĚ SELHAL a událost o doručení by se ztratila.
-- ---------------------------------------------------------------------------
CREATE TABLE message_events (
  id                 uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id       uuid        NOT NULL,
  message_id         uuid        NOT NULL,
  message_created_at timestamptz NOT NULL,
  campaign_id        uuid        NOT NULL,
  contact_id         uuid,
  erased_at          timestamptz,
  -- NEPOVINNÝ (rozhodnutí R33). Povinnost drží ck_message_events__recipient
  -- jen pro doručovací rodinu, na které stojí bounce index. Tracking adresu
  -- k ničemu nepotřebuje a NOT NULL by ji rozmnožoval na každý řádek
  -- desetimilionové tabulky, odkud ji pak musí vybírat GDPR výmaz.
  recipient          text,
  type               text        NOT NULL,
  subtype            text,
  link_id            uuid,
  -- GENEROVANÝ (rozhodnutí R32). Hodnota je čistá funkce typu, takže ji
  -- nemá předávat volající: P13 tutéž škálu drží v katalogu a P10 na ni
  -- zapomněl úplně. Výraz nad literály je IMMUTABLE, takže je legální.
  --
  -- ŽÁDNÁ větev ELSE. Nový typ dopsaný do ck_message_events__type bez ramene
  -- tady dá NULL, NOT NULL ho odmítne a zápis spadne HLASITĚ. S ELSE 0 by
  -- událost tiše dostala rank, který neodpovídá ničemu, a odvození stavu
  -- zprávy by se rozpadlo beze stopy. Že se obě množiny kryjí, hlídá
  -- katalogový test v partitioned-tables.test.ts.
  rank smallint NOT NULL GENERATED ALWAYS AS (CASE type
      WHEN 'open'                 THEN 0
      WHEN 'click'                THEN 0
      WHEN 'unsubscribe'          THEN 0
      WHEN 'circuit_breaker_open' THEN 0
      WHEN 'sent'                 THEN 20
      WHEN 'delivery_delayed'     THEN 25
      WHEN 'delivered'            THEN 30
      WHEN 'bounced_soft'         THEN 60
      WHEN 'bounced_hard'         THEN 80
      WHEN 'complained'           THEN 85
      WHEN 'rejected'             THEN 90
      WHEN 'render_failed'        THEN 95
    END) STORED,
  ts                 timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  source             text        NOT NULL,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, received_at),
  -- Registr vlastní část 4a. Výčet je sjednocení všeho, co kterákoliv část
  -- deklaruje, že zapisuje. Rozšíření je migrace CHECK, ne změna kontraktu.
  CONSTRAINT ck_message_events__type CHECK (type IN (
    'sent','rejected','delivered','delivery_delayed',
    'bounced_hard','bounced_soft','complained','render_failed',
    'open','click','unsubscribe','circuit_breaker_open')),
  CONSTRAINT ck_message_events__source
    CHECK (source IN ('ses_sns','smtp','internal','tracking')),
  -- Stejný vzor jako u web_events: řádek buď má subjekt, nebo je na něm vidět,
  -- že ho schválně nemá po výmazu. S contact_id NOT NULL by hook
  -- tracking.erase_contact skončil chybou 23514 u prvního kontaktu, který kdy
  -- něco otevřel, a výmaz by nikdy neproběhl.
  CONSTRAINT ck_message_events__subject
    CHECK (contact_id IS NOT NULL OR erased_at IS NOT NULL),
  -- Adresu musí mít doručovací rodina, protože na ní stojí bounce index
  -- a rozhodování o suppression. Otevření, proklik, odhlášení ani provozní
  -- událost ji nepotřebují. DEFAULT '' by byl NEPŘIJATELNÝ: prázdné řetězce
  -- by se dostaly do bounce indexu a suppression by pracovala s tichým
  -- nesmyslem. Ověřeno spuštěním: 'delivered' bez adresy skončí chybou
  -- tohohle omezení, 'open' bez adresy projde.
  CONSTRAINT ck_message_events__recipient
    CHECK (type NOT IN ('sent','rejected','delivered','delivery_delayed',
                        'bounced_hard','bounced_soft','complained','render_failed')
           OR recipient IS NOT NULL)
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
-- Timeline jedné zprávy. Obě složky klíče, aby šlo z události skočit na zprávu
-- jedním přístupem do jedné partition.
CREATE INDEX idx_message_events__message
  ON message_events (message_id, message_created_at, ts);
--> statement-breakpoint
CREATE INDEX idx_message_events__campaign_type
  ON message_events (workspace_id, campaign_id, type, ts DESC);
--> statement-breakpoint
CREATE INDEX idx_message_events__contact
  ON message_events (workspace_id, contact_id, ts DESC);
--> statement-breakpoint
-- Rozhodování o suppression podle historie adresy. Bez něj by se počítání
-- soft bounců muselo joinovat na messages přes obě partition.
CREATE INDEX idx_message_events__recipient_bounce
  ON message_events (workspace_id, lower(recipient), ts)
  WHERE type IN ('bounced_soft','bounced_hard','complained');
--> statement-breakpoint
-- Typy, které se nemají opakovat. Index je SCHVÁLNĚ NEUNIKÁTNÍ (rozhodnutí R22).
--
-- Unikátní být nemůže: partiční klíč received_at musí být jeho složkou a je to
-- now(), takže dva zápisy téže události v různý čas jsou dvě různé hodnoty
-- a projdou OBĚ. Unikátní index by tedy sliboval ochranu, kterou nemá, a to je
-- horší než žádná: dvakrát započtený odraz a stížnost rozjedou statistiky
-- kampaně a nikdo nebude vědět proč.
--
-- Deduplikaci NESE provider_event_receipts přes explicitní
-- WHERE NOT EXISTS nad prefixem (workspace_id, dedup_key), viz test
-- "dedup příchozích událostí" v contract-sql.test.ts. Tenhle index slouží
-- tomu dotazu a výpisu historie adresy.
CREATE INDEX idx_message_events__once_per_message
  ON message_events (message_id, type, received_at)
  WHERE type IN ('sent','delivered','bounced_hard','bounced_soft','complained');
--> statement-breakpoint

CREATE TABLE provider_event_receipts (
  id                 uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id       uuid        NOT NULL,
  provider_id        uuid        NOT NULL,
  dedup_key          text        NOT NULL,
  sns_message_id     text,
  event_type         text        NOT NULL,
  message_id         uuid,
  message_created_at timestamptz,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  status             text        NOT NULL DEFAULT 'received',
  raw                jsonb       NOT NULL,
  PRIMARY KEY (id, received_at),
  CONSTRAINT ck_provider_event_receipts__status
    CHECK (status IN ('received','processed','unmatched','invalid'))
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
-- received_at v unikátním indexu je VYNUCENÉ, ne volba. Je to jedna ze čtyř
-- evidovaných výjimek v UNIQUE_INDEX_EXCEPTIONS (rozhodnutí R22). Důsledek:
-- received_at je now(), tedy u každého doručení jiné, takže samotný
-- ON CONFLICT by NIKDY nesepnul. Skutečnou deduplikaci dělá explicitní WHERE NOT EXISTS nad prefixem
-- (workspace_id, dedup_key); ON CONFLICT zůstává jen jako pojistka proti dvěma
-- workerům ve stejné mikrosekundě.
CREATE UNIQUE INDEX uq_provider_event_receipts__dedup
  ON provider_event_receipts (workspace_id, dedup_key, received_at);
--> statement-breakpoint
CREATE INDEX idx_provider_event_receipts__unmatched
  ON provider_event_receipts (received_at) WHERE status = 'unmatched';
--> statement-breakpoint

CREATE TABLE inbound_deliveries (
  id            uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL,
  endpoint_id   uuid        NOT NULL,
  external_id   text,
  status        text        NOT NULL,
  error_code    text,
  error_detail  text,
  contact_id    uuid,
  action        text,
  payload       jsonb       NOT NULL,
  headers       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_inbound_deliveries__status CHECK (status IN
    ('received','processed','ignored','unmapped','rejected','failed'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_inbound_deliveries__dedup
  ON inbound_deliveries (endpoint_id, external_id, created_at)
  WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_inbound_deliveries__endpoint_created
  ON inbound_deliveries (endpoint_id, created_at DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- web_events. Dva časy a rozdíl mezi nimi je podstatný pro každý dotaz:
-- occurred_at je kdy se událost stala, received_at kdy dorazila k nám.
-- Partition se prořezávají podle received_at, ale timeline řadí podle
-- occurred_at, a ty se rozcházejí až o 7 dní. Dotaz na okno podle occurred_at
-- proto MUSÍ nést i podmínku na received_at, jinak se prohledají všechny.
-- ---------------------------------------------------------------------------
CREATE TABLE web_events (
  id                uuid        NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  occurred_at       timestamptz NOT NULL,
  workspace_id      uuid        NOT NULL,
  name              text        NOT NULL,
  anonymous_id      uuid,
  contact_id        uuid,
  session_id        uuid,
  source            text        NOT NULL DEFAULT 'web',
  page              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  properties        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  identity_merge_id uuid,
  erased_at         timestamptz,
  PRIMARY KEY (id, received_at),
  CONSTRAINT ck_web_events__source
    CHECK (source IN ('web','server','email','automation','import')),
  CONSTRAINT ck_web_events__name CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- erased_at je v CHECK schválně. Serverová událost má vyplněné jen contact_id
  -- a výmaz ho nastavuje na NULL, takže bez třetího legitimního stavu by
  -- u každé takové události skončil chybou 23514 a výchozí režim výmazu
  -- by nikdy neproběhl.
  CONSTRAINT ck_web_events__subject CHECK (
    anonymous_id IS NOT NULL OR contact_id IS NOT NULL OR erased_at IS NOT NULL),
  -- Okno mezi vznikem a doručením. Platí pro ŽIVÉ zdroje. Dávkový import
  -- historie je z něj vyňatý, protože u něj se received_at odvozuje
  -- z occurred_at, aby řádek padl do oddílu podle času vzniku.
  CONSTRAINT ck_web_events__lag CHECK (
    source = 'import' OR (
      occurred_at >  received_at - interval '7 days' AND
      occurred_at <= received_at + interval '60 seconds'))
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
-- 1. Timeline kontaktu. Nejčastější dotaz produktu.
CREATE INDEX idx_web_events__contact_occurred
  ON web_events (workspace_id, contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;
--> statement-breakpoint
-- 2. Anonymní timeline a vyhledání událostí k doplnění při slučování identit.
CREATE INDEX idx_web_events__anon_occurred
  ON web_events (workspace_id, anonymous_id, occurred_at DESC)
  WHERE anonymous_id IS NOT NULL;
--> statement-breakpoint
-- 3. Analytika a segmentace typu "kdo udělal X za posledních N dní".
CREATE INDEX idx_web_events__name_occurred
  ON web_events (workspace_id, name, occurred_at DESC);
--> statement-breakpoint
-- 4. Vrácení slučování identit. Řídký, malý.
CREATE INDEX idx_web_events__merge ON web_events (identity_merge_id)
  WHERE identity_merge_id IS NOT NULL;
--> statement-breakpoint
-- 5. Session detail v timeline.
CREATE INDEX idx_web_events__session ON web_events (workspace_id, session_id, occurred_at)
  WHERE session_id IS NOT NULL;
--> statement-breakpoint
-- 6. Deduplikace v aplikačním okně 7 dní. Klíč (id, received_at) opakování
-- nezachytí, protože received_at se pokaždé liší.
CREATE INDEX idx_web_events__dedup ON web_events (workspace_id, id);
--> statement-breakpoint
-- GIN index nad properties se v MVP 0 NEZAKLÁDÁ: u tabulky s desítkami milionů
-- řádků výrazně zpomaluje zápis a nic nad properties zatím nefiltruje.

CREATE TABLE message_engagement (
  message_id           uuid        NOT NULL,
  created_at           timestamptz NOT NULL,
  workspace_id         uuid        NOT NULL,
  campaign_id          uuid        NOT NULL,
  contact_id           uuid,
  erased_at            timestamptz,
  first_open_at        timestamptz,
  last_open_at         timestamptz,
  open_count           integer     NOT NULL DEFAULT 0,
  first_human_open_at  timestamptz,
  human_open_count     integer     NOT NULL DEFAULT 0,
  open_class_mask      integer     NOT NULL DEFAULT 0,
  first_click_at       timestamptz,
  last_click_at        timestamptz,
  click_count          integer     NOT NULL DEFAULT 0,
  first_human_click_at timestamptz,
  human_click_count    integer     NOT NULL DEFAULT 0,
  clicked_links        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, created_at),
  CONSTRAINT ck_message_engagement__subject
    CHECK (contact_id IS NOT NULL OR erased_at IS NOT NULL)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
-- Rekonstrukce campaign_stats po havárii a exporty "kdo otevřel".
CREATE INDEX idx_message_engagement__campaign
  ON message_engagement (workspace_id, campaign_id)
  INCLUDE (first_open_at, first_click_at);
--> statement-breakpoint
-- Segmenty "otevřel libovolnou kampaň za posledních N dní". Částečný, takže
-- vymazaný řádek s contact_id IS NULL do dotazů podle kontaktu nespadne.
CREATE INDEX idx_message_engagement__contact
  ON message_engagement (workspace_id, contact_id, first_open_at DESC)
  WHERE first_open_at IS NOT NULL;
