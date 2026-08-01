-- mlain:timeout=120

-- ---------------------------------------------------------------------------
-- ws_isolation na 65 tabulkách se sloupcem workspace_id.
--
-- KAŽDÁ politika čte kontext přes NULLIF(current_setting(...), ''), nikdy
-- holým current_setting. Rozhodnutí R21, ověřeno spuštěním:
--
--   * na ČERSTVÉM spojení vrátí current_setting('mlain.workspace_id', true)
--     hodnotu NULL a porovnání dá nepravdu, tedy žádné řádky. Tak to plán
--     původně popisoval a potud to platí.
--   * na spojení, kde se kontext NĚKDY nastavil přes SET LOCAL, vrátí táž
--     funkce po commitu PRÁZDNÝ ŘETĚZEC. ''::uuid skončí chybou 22P02, takže
--     druhý dotaz ze stejného poolového spojení bez kontextu SPADNE místo
--     aby vrátil prázdno. V testech s čerstvým poolem se to neprojeví
--     a v provozu se to projeví hned.
--
-- FORCE ROW LEVEL SECURITY se NEPOUŽÍVÁ: schéma vlastní mlain_migrator,
-- aplikace jede pod mlain_app, která ho nevlastní, takže na ni RLS dopadá
-- sama od sebe.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'memberships','invitations','api_keys','idempotency_keys','webhook_endpoints',
    'webhook_events','webhook_deliveries',
    'contacts','contact_fields','tags','contact_tags','lists','list_subscriptions',
    'subscription_confirmations','consents','contact_consent_state','suppressions',
    'imports','import_errors','exports','name_overrides','segments','segment_members',
    'forms','form_submissions','inbound_endpoints','inbound_dedup','inbound_deliveries',
    'gdpr_requests','retention_policies','retention_runs',
    'assets','asset_variants','asset_references',
    'templates','template_versions','brand_profiles','brand_extractions',
    'ai_provider_credentials','ai_conversations','ai_messages','ai_usage_daily',
    'content_snippets',
    'sending_providers','sender_domains','campaigns','campaign_content_variants',
    'campaign_links','deliverability_snapshots','campaign_audience_progress',
    'campaign_render_warnings','messages','message_events','provider_event_receipts',
    'web_event_months','identities','identity_bindings','identity_merges',
    'tracking_domains','contact_engagement','campaign_stats','campaign_stats_buckets',
    'campaign_link_stats','web_events','message_engagement'
  ];
BEGIN
  IF array_length(tables, 1) <> 65 THEN
    RAISE EXCEPTION 'seznam ws_isolation tabulek má % položek, očekává se 65',
      array_length(tables, 1);
  END IF;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY ws_isolation ON %I '
      '  USING      (workspace_id = NULLIF(current_setting(''mlain.workspace_id'', true), '''')::uuid) '
      '  WITH CHECK (workspace_id = NULLIF(current_setting(''mlain.workspace_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_log: NULL ve WITH CHECK je POVINNÝ, jinak spadne změna hesla.
--
-- audit_log.workspace_id je nullable, protože globální akce (user.login,
-- user.password_changed, user.login_failed) k žádnému projektu nepatří.
-- S obyčejnou ws_isolation je NULL = current_setting(...)::uuid vyhodnocené
-- jako NULL, tedy nepravda, takže INSERT globálního záznamu SELŽE na WITH CHECK
-- A VEZME S SEBOU CELOU TRANSAKCI. Protože se audit zapisuje ve stejné transakci
-- jako auditovaná změna, znamenalo by to, že se ZMĚNA HESLA NEULOŽÍ.
-- Přihlašovací flow navíc žádný workspace kontext nenastavuje, takže by tam
-- padalo úplně všechno.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_isolation_audit ON audit_log
  -- Čtení: jen řádky aktuálního projektu. Globální řádky se přes workspace
  -- kontext ZÁMĚRNĚ nečtou, patří uživateli, ne projektu; kdyby je USING
  -- pustilo, viděl by admin projektu A přihlášení uživatelů projektu B.
  USING      (workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NULL
              OR workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Globální auditní záznamy (workspace_id IS NULL) patří uživateli, ne projektu.
-- Bez téhle politiky je repo/audit-global.ts nespustitelné: ws_isolation_audit
-- v USING porovnává jen s mlain.workspace_id, který tahle cesta nenastavuje.
--
-- Podmínka "workspace kontext NENÍ nastavený" je nutná kvůli kritériu 21c,
-- které říká, že se pod kontextem projektu nevrátí ani jeden globální řádek.
-- Bez ní by ho uživatel pod kontextem projektu B viděl, protože withWorkspace
-- u aktéra typu user nastavuje i mlain.user_id a politiky se OR-ují.
-- Ověřeno spuštěním: s podmínkou vrátí dotaz pod kontextem projektu jen
-- projektový záznam a přes withUser jen globální.
-- ---------------------------------------------------------------------------
CREATE POLICY user_own_global_audit ON audit_log FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND workspace_id IS NULL
         AND actor_type = 'user'
         AND actor_id = NULLIF(current_setting('mlain.user_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- workspaces: izolace přes id plus dvě cesty, které kontext z principu nemají.
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_isolation_self ON workspaces
  USING      (id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Výpis projektů aktéra: kontextů je víc než jeden, takže ws_isolation_self
-- by ho zablokovala. Politiky se v PostgreSQL OR-ují, takže ws_isolation_self
-- zůstává pro běžnou cestu nedotčená.
--
-- Podmínka "workspace kontext NENÍ nastavený" je POVINNÁ a je to přesně týž
-- důvod jako u user_own_global_audit: withWorkspace u aktéra typu user
-- nastavuje OBA GUC naráz, takže bez ní se členská politika uplatní i uvnitř
-- projektu a SELECT z workspaces vrátí i ostatní projekty téhož uživatele.
-- Naměřeno běhovým důkazem pod mlain_app na PostgreSQL 18: pod kontextem
-- projektu B vracel dotaz dva řádky, B i A. Únik mezi zákazníky to není
-- (aktér je členem obou), ale kritérium 21d říká JEDEN řádek a vrstva izolace
-- se nemá chovat jinak, než co je o ní napsané.
--
-- Výpis projektů se čte cestou withUser (repo/workspaces-global.ts), která
-- workspace kontext z principu nenastavuje, takže tahle podmínka nic nebere.
CREATE POLICY ws_member_visibility ON workspaces FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND EXISTS (SELECT 1 FROM memberships m
                      WHERE m.workspace_id = workspaces.id
                        AND m.user_id = NULLIF(current_setting('mlain.user_id', true), '')::uuid));
--> statement-breakpoint
-- Založení projektu: kontext ještě neexistuje.
--
-- NULLIF je tu bezpečnostní opatření, ne kosmetika. Holé
-- `current_setting('mlain.user_id', true) IS NOT NULL` je na prázdném řetězci
-- PRAVDA, takže na spojení, které kdykoli dřív obsloužilo přihlášeného
-- uživatele, by politika pustila založení projektu BEZ JAKÉHOKOLI aktéra.
-- Ověřeno spuštěním.
CREATE POLICY ws_insert_bootstrap ON workspaces FOR INSERT
  WITH CHECK (NULLIF(current_setting('mlain.user_id', true), '') IS NOT NULL);
--> statement-breakpoint
-- Poddotaz v ws_member_visibility se vyhodnocuje s politikami tabulky
-- memberships, takže by pod ws_isolation vracel prázdno. Členství vlastního
-- uživatele proto musí být viditelné i bez workspace kontextu.
CREATE POLICY user_own_memberships ON memberships FOR SELECT
  USING (user_id = NULLIF(current_setting('mlain.user_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api_keys: ověření klíče běží MIMO workspace kontext (požadavek P04→P03.5).
--
-- Workspace se z klíče teprve ZJIŠŤUJE, takže ověřovací dotaz nemá co nastavit
-- a jede přes withoutContext. Pod samotnou ws_isolation by SELECT vracel VŽDY
-- nula řádků a KAŽDÝ požadavek s hlavičkou `Authorization: Bearer ml_live_...`
-- by skončil na `unauthenticated`. Nespadlo by to hlasitě: vypadá to jako
-- „klíč neexistuje", tedy jako správné odmítnutí.
--
-- Politika NEFILTRUJE expires_at. Vypršelý klíč musí ověřovací algoritmus
-- najít a odmítnout vlastním kódem chyby; kdyby ho politika schovala, dostal
-- by integrátor „klíč neexistuje" místo „klíč vypršel".
-- ---------------------------------------------------------------------------
CREATE POLICY api_key_lookup ON api_keys FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND revoked_at IS NULL);
--> statement-breakpoint
-- Zápis last_used_at běží toutéž cestou bez kontextu, jen mimo hlavní
-- transakci. Bez politiky pro UPDATE by se `last_used_at` nezapsal nikdy
-- a ticho by bylo úplné: zápis je fire and forget a chybu nikdo nečte.
--
-- WITH CHECK je tu úmyslně PŘÍSNĚJŠÍ než USING a je to táž úvaha jako
-- u sender_bypass na campaigns: politika, která pouští UPDATE, nesmí mlčet
-- o HODNOTÁCH. Nový řádek musí nést čerstvý last_used_at, takže bezkontextový
-- `UPDATE api_keys SET scopes = ...` skončí chybou RLS místo tichého rozšíření
-- oprávnění klíče. Není to zeď (kdo přidá i last_used_at = now(), projde),
-- je to pojistka, která tichou cestu mění na hlasitou.
CREATE POLICY api_key_touch ON api_keys FOR UPDATE
  USING      (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
              AND revoked_at IS NULL)
  WITH CHECK (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
              AND revoked_at IS NULL
              AND last_used_at >= now() - interval '1 minute');
--> statement-breakpoint
-- Ověřovací dotaz JOINuje workspaces kvůli deleted_at, protože klíč zrušeného
-- projektu nesmí projít. Pod mlain_app na workspaces dopadá RLS taky, takže
-- by JOIN nevrátil nic a api_key_lookup by byla k ničemu: klíč by se našel
-- a JOIN by ho zase zahodil, opět tiše.
--
-- Podmínka „ani jeden kontext není nastavený" je POVINNÁ. Kdyby politika
-- platila i pod mlain.user_id, uplatnila by se na výpisu projektů
-- (repo/workspaces-global.ts čte holé SELECT FROM workspaces pod withUser)
-- a uživatel by ve svém seznamu uviděl cizí projekt, který má API klíč.
-- EXISTS se vyhodnocuje pod politikami api_keys, tedy pod api_key_lookup výš.
CREATE POLICY ws_api_key_lookup ON workspaces FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND NULLIF(current_setting('mlain.user_id', true), '') IS NULL
         AND EXISTS (SELECT 1 FROM api_keys k
                      WHERE k.workspace_id = workspaces.id AND k.revoked_at IS NULL));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- invitations: dohledání pozvánky podle token_hash (požadavek P04→P03.6).
--
-- Pozvánku přijímá uživatel, který v projektu JEŠTĚ NENÍ, takže workspace
-- kontext nemá odkud vzít; jede přes withUser. Bez téhle politiky vrátí
-- acceptInvitation VŽDY 404 a z hlášky to nikdo nepozná, protože plán vrací
-- 404 schválně i u neplatného tokenu, aby nešlo zjistit, jestli pozvánka
-- existuje.
--
-- Únik je nulový: jediný filtr, který volající má, je token_hash s unikátním
-- indexem. Bez znalosti tokenu se z tabulky nedá vybrat nic užitečného
-- a politika navíc pouští jen pozvánky živé, nepřijaté a neodvolané.
--
-- Obdoba ws_api_key_lookup pro workspaces tu ZÁMĚRNĚ NENÍ. Přijetí běží pod
-- mlain.user_id, takže by taková politika platila i na výpisu projektů
-- a každý přihlášený uživatel by v seznamu viděl cizí projekt s otevřenou
-- pozvánkou. Jméno a slug projektu si volající přečte až v druhé transakci,
-- která workspace kontext z pozvánky nastavuje, a tam ho pustí ws_isolation_self.
-- ---------------------------------------------------------------------------
CREATE POLICY invitation_token_lookup ON invitations FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > now());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sender_bypass. Tvrzení "sender nepodléhá RLS" bez mechanismu je NEFUNKČNÍ:
-- role mlain_sender nemá BYPASSRLS a nikdy nevolá set_config('mlain.workspace_id'),
-- protože pracuje napříč projekty. current_setting(..., true) proto vrátí NULL,
-- ws_isolation nepustí nic a claim dotaz by vracel NULA ŘÁDKŮ VŽDY.
--
-- ALTER ROLE mlain_sender BYPASSRLS se nepoužívá: je hrubší (platí na všechno
-- včetně tabulek, na které sender přístup mít nemá) a vyžaduje superuživatele,
-- takže by patřilo do docker/initdb, ne do migrace.
--
-- U campaigns je WITH CHECK POVINNÝ a je to jediné místo, kde se vynucuje,
-- že sender kampaň smí jen POZASTAVIT. Sloupcový grant povoluje zápis do
-- status a pause_reason, ale neříká NIC o hodnotě: bez WITH CHECK by šlo
-- nastavit status = 'sent' nebo 'cancelled'. Kdyby politika WITH CHECK
-- neměla, použil by PostgreSQL u UPDATE klauzuli USING, a ta je `true`.
-- Ověřeno spuštěním: s WITH CHECK projde přechod na 'paused' a pokusy
-- o 'sent' i 'cancelled' skončí chybou RLS.
-- ---------------------------------------------------------------------------
CREATE POLICY sender_bypass ON messages          TO mlain_sender USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON campaigns         TO mlain_sender
  USING (true) WITH CHECK (status = 'paused');
--> statement-breakpoint
CREATE POLICY sender_bypass ON sending_providers TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON campaign_links    TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON workspaces        TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON suppressions      TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON message_events    TO mlain_sender WITH CHECK (true);
--> statement-breakpoint
-- campaign_render_warnings: sender píše agregovaná varování z renderu přes
-- INSERT ... ON CONFLICT DO UPDATE, takže potřebuje USING i WITH CHECK.
-- Bez téhle politiky by zápis neprošel NIKDY a report varování by byl vždy
-- prázdný, aniž by kdokoli viděl chybu, protože sender ji jen zaloguje.
CREATE POLICY sender_bypass ON campaign_render_warnings TO mlain_sender
  USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- maintenance_bypass. Retenční job běží NAPŘÍČ projekty a mlain.workspace_id
-- nenastavuje, takže by ws_isolation nepustila ani řádek. DELETE by pak
-- ovlivnil NULA ŘÁDKŮ A NEVRÁTIL CHYBU: retence osobních údajů by se nikdy
-- neprovedla a nikdo by se to nedozvěděl. Role nemá BYPASSRLS, protože ta
-- platí na všechno včetně tabulek, kam nesmí.
-- ---------------------------------------------------------------------------
CREATE POLICY maintenance_bypass ON web_events TO mlain_maintenance USING (true);
