-- mlain:timeout=120

-- ===========================================================================
-- Systémové skeny napříč projekty pod rolí mlain_maintenance.
--
-- PROČ VŮBEC. Pět cronových úloh workeru potřebuje výčet NAPŘÍČ instalací:
-- plánovač kampaní (`listWorkspaces`), rekonciliace outboxu (`listWorkspaces`),
-- hlídač běžících kampaní (`listRunning`), obnova po kvótě (`listPaused`)
-- a rekontrola odesílacích domén (`listDue`). Worker jede pod DATABASE_URL,
-- tedy jako mlain_app, a ta bez nastaveného `mlain.workspace_id` nesplní ani
-- jednu politiku z migrace 0004.
--
-- Ověřeno spuštěním, ne odvozeno: pod mlain_app bez kontextu vrátí
-- `SELECT count(*) FROM workspaces` NULU, přestože řádky existují.
-- Dopad není teoretický. Kampaň naplánovaná na zítřejší devátou se v devět
-- neodešle, nikde se to neukáže a nic neselže, protože plánovač prostě nemá
-- co zpracovat. Tatáž příčina stojí za tím, že `platform.purge_workspaces`
-- běží a nemaže nic: `DELETE FROM workspaces` pod spojením bez kontextu
-- zasáhne nula řádků a vrátí `DELETE 0`.
--
-- TVAR ŘEŠENÍ je opsaný z `sender_bypass` v migraci 0004, včetně důvodu, proč
-- se NEPOUŽÍVÁ `ALTER ROLE ... BYPASSRLS`: ta je hrubší (platí i na tabulky,
-- kam role nemá co sahat, například contacts nebo consents), a vyžaduje
-- superuživatele, takže by patřila do docker/initdb, ne do migrace.
--
-- PROČ mlain_maintenance A NE NOVÁ ROLE. Role pro systémovou údržbu už
-- existuje a její definice v docker/initdb zní „úlohy, které běží napříč
-- projekty a workspace kontext nemají odkud vzít". Retence `web_events`
-- a tyhle skeny jsou přesně tatáž věc; liší se jen tabulkou. Druhá role by
-- znamenala druhé volitelné připojení, druhou sadu politik stejného tvaru
-- a druhé heslo, které musí operátor nastavit, a NEZMENŠILA by dosah chyby:
-- obě spojení drží tentýž proces workeru. Nejmenší oprávnění se tu drží
-- na úrovni TABULEK a PŘÍKAZŮ, ne na úrovni rolí, a to je vidět níž.
--
-- VÝČET JE JMENOVITÝ, nikdy plošný. Tři tabulky, každá s vlastním důvodem:
--   workspaces     ... `listWorkspaces` plánovače i rekonciliace outboxu
--   campaigns      ... `listRunning` hlídače a `listPaused` obnovy po kvótě
--   sender_domains ... `listDue` rekontroly domén
-- Nic dalšího. Jakmile má úloha ID projektu, pokračuje pod mlain_app
-- v systémovém kontextu toho projektu a dopadá na ni RLS úplně stejně jako
-- na požadavek z API. Kontakty, zprávy, souhlasy ani audit tahle role nevidí
-- a vidět nesmí; hlídá to test `maintenance-scan.test.ts`.
--
-- ZÁPIS JE JEDINÝ a je omezený: DELETE na `workspaces` pro úklid projektů po
-- uplynutí lhůty na obnovu. Politika ho pouští jen na řádky, které UŽ JSOU
-- měkce smazané. Bez toho omezení by chyba v úklidové úloze uměla smazat živý
-- projekt se všemi daty, protože smazání workspace je jediná operace, která
-- maže kaskádou.
--
-- Podmínka NENÍ `deleted_at < now() - interval '30 dnů'`, přestože přesně tak
-- zní dotaz úlohy. Lhůta je konstanta `RESTORE_WINDOW_DAYS` v aplikaci a smí
-- se změnit; kdyby ji politika kopírovala, po zkrácení lhůty by úloha běžela
-- dál, mazala nula řádků a nikdo by se to nedozvěděl. Politika drží invariant,
-- který se nemění („živý projekt tahle role nesmaže"), lhůtu vlastní úloha.
-- ===========================================================================
CREATE POLICY maintenance_scan ON workspaces FOR SELECT TO mlain_maintenance
  USING (true);
--> statement-breakpoint

CREATE POLICY maintenance_purge ON workspaces FOR DELETE TO mlain_maintenance
  USING (deleted_at IS NOT NULL);
--> statement-breakpoint

CREATE POLICY maintenance_scan ON campaigns FOR SELECT TO mlain_maintenance
  USING (true);
--> statement-breakpoint

CREATE POLICY maintenance_scan ON sender_domains FOR SELECT TO mlain_maintenance
  USING (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Zúžení dvou politik na `workspaces` z PUBLIC na mlain_app.
--
-- BEZ TOHOHLE JE VŠECHNO VÝŠ K NIČEMU a projeví se to způsobem, který vypadá
-- jako úplně jiná vada:
--
--   ERROR:  permission denied for table memberships
--
-- při obyčejném `SELECT count(*) FROM workspaces` pod rolí mlain_maintenance.
-- Ověřeno spuštěním, ne odvozeno.
--
-- Příčina: politiky jsou permisivní a spojují se OR, takže PostgreSQL k dotazu
-- přibalí i `ws_member_visibility` a `ws_api_key_lookup`. Obě mají uvnitř
-- poddotaz do `memberships`, respektive `api_keys`, a na relaci v plánu se
-- kontrolují práva bez ohledu na to, že by výsledek stejně přebila politika
-- `maintenance_scan` s `USING (true)`.
--
-- Nejhorší na tom je, že se to chová NESPOLEHLIVĚ: jestli se poddotaz do plánu
-- dostane, závisí na jeho tvaru. `SELECT id FROM workspaces WHERE deleted_at
-- IS NULL` prošel, `SELECT count(*) FROM workspaces` nad týmiž daty spadl.
-- Vada, která se objeví se změnou statistik, je horší než vada trvalá.
--
-- Rozdat roli SELECT na `memberships` a `api_keys` by to taky spravilo a byla
-- by to CHYBA: výjimka z izolace by se rozlila na tabulku s vazbou uživatel
-- na projekt a na tabulku klíčů. Správná odpověď je opačná, totiž říct, komu
-- ty dvě politiky patří. Patří výhradně aplikační roli:
--   ws_member_visibility ... výpis projektů přihlášeného uživatele
--   ws_api_key_lookup    ... ověření API klíče před sestavením kontextu
-- Sender má `sender_bypass`, maintenance má `maintenance_scan`, migrátor je
-- vlastník a RLS na něj nedopadá.
--
-- Je to tedy ZPŘÍSNĚNÍ modelu, ne ústupek: politika psaná pro PUBLIC platila
-- i pro role, které o ni nikdy nestály.
-- ---------------------------------------------------------------------------
ALTER POLICY ws_member_visibility ON workspaces TO mlain_app;
--> statement-breakpoint

ALTER POLICY ws_api_key_lookup ON workspaces TO mlain_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mlain_apply_grants(): ÚPLNÁ definice, tohle je od teď ta platná.
--
-- Kopie těla z migrace 0005 je vědomá a nejde se jí vyhnout. Migrační runner
-- hlídá drift hashem souboru (`migration_hash_mismatch`), takže vydaná migrace
-- se needituje ani o bílý znak; 0005 je tedy historický záznam a měnit se
-- nesmí. Rozdělit granty do dvou funkcí taky nejde: funkce je podle rozhodnutí
-- R25 ÚPLNÝ popis oprávnění a volá ji `mlain doctor --fix` i obnova ze zálohy.
-- Kdyby nová práva ležela mimo ni, první `SELECT mlain_apply_grants()` po
-- obnově by je smetl REVOKE ALL v cyklu a skeny by po obnově tiše přestaly
-- fungovat. Platná je vždy definice z NEJVYŠŠÍ migrace.
--
-- Proti 0005 přibyl jediný blok, a to úplně dole u mlain_maintenance.
-- ---------------------------------------------------------------------------
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
  REVOKE UPDATE, DELETE ON web_events FROM mlain_app;
  GRANT  UPDATE (contact_id, identity_merge_id, erased_at) ON web_events TO mlain_app;

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
