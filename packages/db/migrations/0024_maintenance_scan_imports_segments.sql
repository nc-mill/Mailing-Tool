-- mlain:timeout=120

-- ===========================================================================
-- Systémový sken NAPŘÍČ PROJEKTY pro `imports` a `segments`.
--
-- CO BYLO ŠPATNĚ. Migrace 0009 dala roli `mlain_maintenance` výjimku z izolace
-- na tři tabulky: `workspaces`, `campaigns` a `sender_domains`. Dva cronové
-- skeny ale potřebují čtvrtou a pátou, a ani jeden z nich pod tou rolí neběžel:
--   * `contacts.import.recover_stale` hledá zaseknuté importy v `imports`,
--   * `segments.recount` hledá zastaralé segmenty v `segments`.
-- Oba jely přes `withoutContext`, tedy pod `mlain_app` BEZ nastaveného
-- `mlain.workspace_id`. Politika `ws_isolation` porovnává `workspace_id`
-- s NULL, výsledek je NULL, tedy nepravda, tedy ŽÁDNÉ ŘÁDKY. A hlavně ŽÁDNÁ
-- CHYBA.
--
-- Ověřeno spuštěním proti běžící databázi, ne odvozeno:
--     mlain_migrator: SELECT count(*) FROM imports  -> 3
--     mlain_app bez kontextu: totéž               -> 0
--
-- DOPAD U IMPORTŮ JE TRVALÝ. Zabitý worker nechá řádek ve stavu `importing`.
-- `confirmImport` odmítne každý další import v tomtéž projektu, dokud tam
-- takový řádek leží (`import_already_running`), a obnova, která by ho uklidila,
-- ho nevidí. Projekt tedy zůstane bez importů napořád a job přitom každou
-- hodinu hlásí `{ recovered: 0 }`, což vypadá jako „nic k práci".
--
-- ---------------------------------------------------------------------------
-- PROČ JSOU GRANTY SLOUPCOVÉ
-- ---------------------------------------------------------------------------
-- U tří tabulek z 0009 je grant na celou tabulku, protože v nich nic osobního
-- není. Tady je situace jiná a stojí za to ji držet těsněji:
--   * `imports` nese `filename` (často jméno člověka nebo firmy), `mapping`
--     a `error_summary`, do kterého se ukládají UKÁZKY HODNOT z nahraného CSV,
--     tedy potenciálně e-maily a jména kontaktů.
--   * `segments` nese `definition`, tedy podmínky, které si projekt napsal.
--
-- Sken z nich potřebuje ID a pár řídicích sloupců, nic víc. Sloupcový grant
-- to říká databázi, ne komentářem: dotaz na `filename` nebo `error_summary`
-- pod touhle rolí skončí na `permission denied`, hlasitě. Je to tentýž vzorec,
-- jaký migrace 0005 používá na `messages`, `campaigns` a `web_events`.
--
-- ---------------------------------------------------------------------------
-- POLITIKA A GRANT JSOU DVĚ RŮZNÉ VĚCI
-- ---------------------------------------------------------------------------
-- Bez grantu skončí dotaz na `permission denied`, bez politiky vrátí prázdno
-- a NIC neohlásí. Ta druhá varianta je horší, proto se přidává obojí.
--
-- `ws_isolation` se na těchhle dvou tabulkách NEZUŽUJE z PUBLIC na mlain_app,
-- na rozdíl od toho, co 0009 udělala u `workspaces`. Důvod tam byl konkrétní:
-- politiky `ws_member_visibility` a `ws_api_key_lookup` mají uvnitř poddotaz
-- do `memberships` a `api_keys` a PostgreSQL na ně kontroluje práva, i když
-- by výsledek stejně přebila permisivní `maintenance_scan`. Tady žádná
-- politika poddotaz nemá (obě tabulky mají jedinou, `ws_isolation`, a ta
-- porovnává vlastní sloupec s GUC), takže není co zpřísňovat.
--
-- ---------------------------------------------------------------------------
-- PROČ SE CELÁ FUNKCE OPISUJE
-- ---------------------------------------------------------------------------
-- Rozhodnutí R25: `mlain_apply_grants()` je ÚPLNÝ popis oprávnění a volá ji
-- `mlain doctor --fix` i obnova ze zálohy. Nová práva mimo ni by první volání
-- po obnově smetlo REVOKE ALL v cyklu a skeny by po obnově tiše přestaly
-- fungovat. Platná je vždy definice z NEJVYŠŠÍ migrace, tedy tahle.
--
-- Proti 0022 přibyl jediný blok, a to úplně dole u mlain_maintenance.
-- ===========================================================================
CREATE POLICY maintenance_scan ON imports FOR SELECT TO mlain_maintenance
  USING (true);
--> statement-breakpoint

CREATE POLICY maintenance_scan ON segments FOR SELECT TO mlain_maintenance
  USING (true);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION mlain_apply_grants() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  t text;
BEGIN
  -- Seznam tabulek se bere Z KATALOGU, ne z výčtu v kódu. Dvě podmínky nesou
  -- celé rozhodnutí R20:
  --   relispartition = false  ... měsíční oddíl NEDOSTANE ŽÁDNÉ PRÁVO. Oddíl
  --     nedědí relrowsecurity ani politiky, takže grant na oddílu je díra
  --     vedle RLS: přímý SELECT z oddílu vrátí řádky všech projektů a přímý
  --     DELETE z oddílu audit_log smaže i cizí a globální záznamy.
  --     Přístup přes rodiče funguje bez toho, práva se kontrolují na relaci,
  --     na kterou dotaz míří.
  --   relkind IN ('r','p')    ... běžné i partitionované tabulky, ne pohledy.
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relispartition = false
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM mlain_app, mlain_sender, '
                   'mlain_gdpr, mlain_maintenance', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mlain_app', t);
  END LOOP;

  GRANT USAGE ON SCHEMA public TO mlain_app, mlain_sender, mlain_gdpr,
                                  mlain_maintenance, mlain_backup;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mlain_app;

  -- -------------------------------------------------------------------------
  -- Append-only. Vynucuje se ODEBRÁNÍM PRÁV, ne pravidly. Varianta
  -- `CREATE RULE ... DO INSTEAD NOTHING` je zamítnutá a nesmí se použít:
  -- pravidlo na DELETE tiše zablokuje i ON DELETE CASCADE z contacts, takže
  -- smazání kontaktu proběhne bez chyby, ale jeho souhlasy zůstanou jako
  -- osiřelé řádky s osobními údaji.
  -- -------------------------------------------------------------------------
  REVOKE UPDATE, DELETE ON audit_log      FROM mlain_app;
  REVOKE UPDATE, DELETE ON consents       FROM mlain_app;
  REVOKE UPDATE, DELETE ON message_events FROM mlain_app;

  -- web_events NEMŮŽE být čistě append-only a je to poctivé přiznání, ne
  -- výjimka z rozmaru: doplnění identity, GDPR anonymizace i vrácení sloučení
  -- musí na existující řádek sáhnout. Sloupcový grant zachová záměr konvence
  -- (obsah události je neměnný) a povolí jen atribuční sloupce. Pokus o UPDATE
  -- jiného sloupce skončí chybou oprávnění, tedy hlasitě a v testu.
  -- erased_at MUSÍ být ve výčtu, jinak GDPR výmaz narazí na oprávnění
  -- místo na constraint.
  --
  -- ZMĚNA PROTI 0009: `properties` a `context`. Bez nich odstřihne výmaz podle
  -- článku 17 jen vazbu a e-mail, jméno i otisk prohlížeče zůstanou v řádku
  -- napořád. Výčet zůstává sloupcový právě proto, aby zápis do `name`,
  -- `occurred_at` nebo `source` dál končil chybou: obsah události se
  -- nepřepisuje, maže se jen to, co je osobní.
  REVOKE UPDATE, DELETE ON web_events FROM mlain_app;
  GRANT  UPDATE (contact_id, identity_merge_id, erased_at, properties, context)
    ON web_events TO mlain_app;

  REVOKE UPDATE ON message_engagement FROM mlain_app;
  GRANT  UPDATE (contact_id, erased_at, first_open_at, last_open_at, open_count,
                 first_human_open_at, human_open_count, open_class_mask,
                 first_click_at, last_click_at, click_count,
                 first_human_click_at, human_click_count, clicked_links)
    ON message_engagement TO mlain_app;

  GRANT UPDATE (contact_id, erased_at, recipient) ON message_events TO mlain_app;

  -- system_settings drží schema_version, ze kterého se odvozuje downgrade
  -- guard migračního runneru. Aplikační role ho přepsat nesmí, jinak si
  -- instalace umí ochranu proti downgradu vypnout sama.
  REVOKE UPDATE, DELETE ON system_settings FROM mlain_app;
  GRANT  UPDATE (secret_key_fingerprint, setup_completed_at, settings, updated_at)
    ON system_settings TO mlain_app;
  REVOKE UPDATE, DELETE ON secret_key_generations FROM mlain_app;
  GRANT  UPDATE (retired_at) ON secret_key_generations TO mlain_app;

  -- -------------------------------------------------------------------------
  -- mlain_sender: KONTRAKTNÍ blok. Přebírá se z části 1, 4.10.1.
  -- Každá tabulka v tomhle bloku MUSÍ mít politiku sender_bypass, jinak grant
  -- nic neznamená; kontroluje to test nad katalogem, ne seznam v kódu.
  -- -------------------------------------------------------------------------
  -- Sloupcové granty na messages: sender smí měnit jen to, co je jeho.
  -- Bez nich by chyba v senderu mohla přepsat render_data nebo email.
  --
  -- created_at ve výčtu SCHVÁLNĚ NENÍ: invariant I1 říká, že celá kampaň leží
  -- v jedné partition vybrané při materializaci a sender do toho nesahá.
  --
  -- ambiguous_count ve výčtu BÝT MUSÍ: reaper nejednoznačných odeslání běží
  -- uvnitř senderu a dělá SET ambiguous_count = ambiguous_count + 1. Bez tohohle
  -- sloupce skončí na permission denied a celý mechanismus ambiguous_dispatch
  -- včetně scénářů OB-03 a OB-04 je neproveditelný.
  GRANT SELECT ON messages TO mlain_sender;
  GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at,
                dispatch_started_at, attempts, next_attempt_at,
                provider_message_id, sent_at, error_code, error_detail,
                ambiguous_count, updated_at)
    ON messages TO mlain_sender;

  GRANT SELECT ON campaigns TO mlain_sender;
  -- Sloupcový GRANT UPDATE na campaigns: sender smí kampaň POUZE pozastavit.
  -- Grant říká, DO KTERÝCH sloupců smí psát; že smí nastavit jen 'paused',
  -- vynucuje WITH CHECK politiky sender_bypass z migrace 0004. Bez obojího
  -- neplatí circuit breaker, ani pravidlo o 5 % selhání renderu, ani
  -- SENDER_CREDENTIALS_MAX_RETRIES. Grant je sloupcový, NIKDY na celou tabulku:
  -- sender nesmí sáhnout na compiled_html ani na subject.
  GRANT UPDATE (status, pause_reason) ON campaigns TO mlain_sender;

  GRANT SELECT ON sending_providers TO mlain_sender;
  GRANT SELECT ON campaign_links    TO mlain_sender;
  GRANT SELECT ON workspaces        TO mlain_sender;
  -- Bez SELECT na suppressions je přechod claimed -> skipped, který kontrakt
  -- sám povoluje, fyzicky neproveditelný.
  GRANT SELECT ON suppressions      TO mlain_sender;
  GRANT INSERT ON message_events    TO mlain_sender;
  -- Agregovaná varování z renderu. Sender je drží v paměti a zapisuje jednou
  -- za 10 sekund přes INSERT ... ON CONFLICT DO UPDATE. SELECT tu MUSÍ být:
  -- ON CONFLICT DO UPDATE čte existující řádek, takže bez něj skončí zápis
  -- na permission denied ještě dřív, než na něj dopadne RLS.
  GRANT SELECT, INSERT, UPDATE ON campaign_render_warnings TO mlain_sender;

  -- Žádná práva na contacts, web_events, users, sessions, api_keys, audit_log.
  -- Sender kontakty nečte, data má v render_data. Zajišťuje to REVOKE ALL
  -- v cyklu výš, ne výčet tabulek, na které se zapomnělo.

  -- -------------------------------------------------------------------------
  -- mlain_gdpr: výhradně job gdpr.erase. Výmaz podle čl. 17 musí souhlasy
  -- smazat a aplikační role na to právo nemá, protože consents je append only.
  --
  -- SELECT tu MUSÍ být: `DELETE FROM consents WHERE contact_id = $1` čte
  -- sloupec v podmínce, takže se samotným DELETE skončí na
  -- `permission denied for table consents`. Ověřeno spuštěním. Test, který
  -- to nezachytil, mazal bez WHERE, což je tvar, jaký job nikdy nepoužije.
  -- -------------------------------------------------------------------------
  GRANT SELECT, DELETE ON consents TO mlain_gdpr;

  -- -------------------------------------------------------------------------
  -- mlain_maintenance: retenční job. SELECT je tu ze stejného důvodu jako
  -- u mlain_gdpr, politiku maintenance_bypass přidává migrace 0004.
  -- -------------------------------------------------------------------------
  GRANT SELECT, DELETE ON web_events TO mlain_maintenance;

  -- -------------------------------------------------------------------------
  -- mlain_maintenance, systémové skeny napříč projekty (migrace 0009).
  --
  -- Grant a politika jsou DVĚ RŮZNÉ VĚCI a bez obou to nefunguje: bez grantu
  -- skončí dotaz na `permission denied`, bez politiky vrátí prázdno a NIC
  -- neohlásí. Ta druhá varianta je horší, protože vypadá jako „nic k práci".
  --
  -- Tři tabulky, jmenovitě. Skeny z nich čtou jen ID projektu, aby mohly
  -- pokračovat pod mlain_app v kontextu toho projektu.
  -- -------------------------------------------------------------------------
  GRANT SELECT ON workspaces     TO mlain_maintenance;
  GRANT SELECT ON campaigns      TO mlain_maintenance;
  GRANT SELECT ON sender_domains TO mlain_maintenance;

  -- Migrace 0024. Dvě tabulky navíc, obě jen SLOUPCOVĚ.
  --
  -- `imports`: obnova zaseknutých importů (`contacts.import.recover_stale`).
  --   Sken vybírá `id` a `workspace_id` a filtruje podle `status` a
  --   `updated_at`, což je přesně tenhle výčet. Sloupce ve WHERE ve výčtu BÝT
  --   MUSÍ, právo se kontroluje na každý dotčený sloupec, ne jen na vracené.
  --   `filename`, `mapping` ani `error_summary` role nepřečte, protože
  --   `error_summary` může nést ukázky hodnot z nahraného CSV.
  --
  -- `segments`: plánovač přepočtu (`segments.recount`). Sken vybírá `id`
  --   a `workspace_id` a filtruje podle `deleted_at`, `kind` a `cached_at`.
  --   `definition` a `name` role nepřečte.
  GRANT SELECT (id, workspace_id, status, updated_at) ON imports  TO mlain_maintenance;
  GRANT SELECT (id, workspace_id, deleted_at, kind, cached_at)
    ON segments TO mlain_maintenance;

  -- Jediné právo na zápis, které tahle role má. Úklid projektů po uplynutí
  -- lhůty na obnovu; politika maintenance_purge ho pouští jen na řádky, které
  -- už jsou měkce smazané. Bez DELETE vrací úloha `DELETE 0` a tváří se,
  -- že uklidila.
  GRANT DELETE ON workspaces TO mlain_maintenance;
END
$fn$;
--> statement-breakpoint

-- Odebrat právo volání všem kromě vlastníka. CREATE OR REPLACE práva zachovává,
-- ale opakuje se to tu schválně: po obnově ze zálohy je stav práv na funkci
-- to poslední, na co se někdo podívá.
REVOKE ALL ON FUNCTION mlain_apply_grants() FROM PUBLIC;
--> statement-breakpoint

SELECT mlain_apply_grants();
