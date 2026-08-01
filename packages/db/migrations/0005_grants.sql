-- mlain:timeout=120

-- ---------------------------------------------------------------------------
-- mlain_apply_grants(): ÚPLNÝ a IDEMPOTENTNÍ popis oprávnění.
--
-- Volá ji tahle migrace, `mlain doctor --fix` a postup obnovy ze zálohy (P16).
-- Opakované zavolání musí skončit ve stejném stavu, proto se každý blok
-- otevírá REVOKE ALL a teprve pak přiděluje.
--
-- Funkce NEMÁ SECURITY DEFINER: běží pod tím, kdo ji volá, a to musí být
-- vlastník tabulek, tedy mlain_migrator. Kdyby ji uměla zavolat aplikační
-- role, mohla by si přidělit práva sama.
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
  -- mlain_backup: jen pg_dump, nikdy nezapisuje. Roli pg_read_all_data
  -- přiděluje docker/initdb (vyžaduje superuživatele), tady jen USAGE.
  --
  -- pg_read_all_data NENÍ totéž co BYPASSRLS. Pod rolí, na kterou RLS platí,
  -- doběhne pg_dump bez chyby a vyrobí dump, ve kterém má každá chráněná
  -- tabulka NULA ŘÁDKŮ. Kontrolu, že záloha neběží pod takovou rolí, dělá
  -- `mlain backup` (P16); tady se jen nepřiděluje nic, co by to zamaskovalo.
  -- -------------------------------------------------------------------------
END
$fn$;
--> statement-breakpoint

-- Odebrat právo volání všem kromě vlastníka. Kdyby funkci uměla zavolat
-- aplikační role, přidělila by si REVOKE i GRANT sama.
REVOKE ALL ON FUNCTION mlain_apply_grants() FROM PUBLIC;
--> statement-breakpoint

SELECT mlain_apply_grants();
