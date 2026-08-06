-- mlain:timeout=120

-- ===========================================================================
-- Dosypání měkkého smazání PRACOVNÍMU OBSAHU kampaní, které se smazaly dřív,
-- než se to začalo propisovat.
--
-- CO JE PRACOVNÍ OBSAH. Kampaň nemá vlastní editor: upravovat se dá jedině
-- šablona (`PATCH /api/v1/templates/{id}`), takže si zakládání kampaně vyrobí
-- v `templates` VLASTNÍ řádek s `kind = 'system'` a namíří na něj
-- `campaigns.template_id`. Uživatel ten řádek nikdy nevidí, knihovna šablon ho
-- z výpisu vynechává. Je to plátno jedné kampaně, ne šablona.
--
-- CO SE POKAZILO. Smazání kampaně bylo měkké a končilo na `campaigns`. Pracovní
-- obsah zůstával s `deleted_at IS NULL`, tedy jako řádek, který se z pohledu
-- databáze nikdy nesmazal, přestože nese CELÝ TEXT E-MAILU: oslovení, jména,
-- adresy, cokoli si tam uživatel napsal. U produktu, který mazání osobních
-- údajů slibuje, je to rozdíl mezi „smazáno" a „jen schováno před výpisem".
-- Kód to od téhle chvíle dělá sám (`deleteWorkingCopy` v jádru kampaní), tahle
-- migrace dohání to, co vzniklo předtím.
--
-- ---------------------------------------------------------------------------
-- PROČ SE NEPOUŽÍVÁ `now()`
-- ---------------------------------------------------------------------------
-- Konvence 2.4 zakazuje čtení hodin v migraci mimo DEFAULT, a hlídá to
-- `tools/ci/migration-lint.mjs`. Kvůli témuž pravidlu se opravovaly migrace
-- 0018 a 0019. Razítko se proto bere Z KAMPANĚ: pracovní obsah se přestal
-- používat v tu chvíli, kdy odešla poslední kampaň, která ho držela, takže
-- `max(c.deleted_at)` je pravdivější hodnota než čas spuštění migrace. Navíc
-- vyjde na každé instalaci stejně, ať se migrace pustí kdykoli.
--
-- `updated_at` se ZÁMĚRNĚ nepřepisuje, ze stejného důvodu a stejně jako v 0019:
-- sloupec drží čas poslední skutečné změny obsahu, ne razítko dosypání.
--
-- ---------------------------------------------------------------------------
-- PROČ JE PODMÍNKA TAK ÚZKÁ
-- ---------------------------------------------------------------------------
--  * `kind = 'system'` ... knihovní šablony se nesmí dotknout ANI JEDNA. Kampaň
--    z doby před pracovními kopiemi může mít `template_id` namířené rovnou do
--    knihovny a ta šablona je práce uživatele pro příště, ne odpad po kampani.
--  * `deleted_at IS NULL` ... už smazané řádky se nepřerazítkovávají, jinak by
--    druhé spuštění posunulo čas smazání. Migrace je tím idempotentní.
--  * `EXISTS ... deleted_at IS NOT NULL` ... dosypává se jen tomu, po kom
--    smazaná kampaň opravdu zůstala. Pracovní obsah bez jakékoli kampaně
--    (kampaň se tvrdě smazala a cizí klíč `ON DELETE SET NULL` odkaz vynuloval)
--    se NECHÁVÁ BÝT: nikdo neví, jestli za ním bylo smazání, nebo porucha, a
--    mazat naslepo data uživatele kvůli dohadu se nesmí.
--  * `NOT EXISTS ... deleted_at IS NULL` ... a tohle není opatrnost navíc.
--    `POST /campaigns/{id}/duplicate` kopíruje `template_id` beze změny, takže
--    kopie a předloha SDÍLEJÍ jeden pracovní obsah. Bez téhle podmínky by
--    smazání kopie vzalo obsah i kampani, která zůstala živá, a editor by u ní
--    hlásil, že šablona neexistuje.
--
-- Migrace běží pod `mlain_migrator`, tedy pod vlastníkem tabulky, na kterého se
-- politiky RLS nevztahují. Podmínka `c.workspace_id = t.workspace_id` je v ní
-- přesto: sloučení přes `template_id` samo o sobě projekt nehlídá a izolace se
-- nemá opírat o to, že se odkaz přes hranici projektu nikdy nevyrobí.
-- ===========================================================================
UPDATE templates t
   SET deleted_at = (
         SELECT max(c.deleted_at)
           FROM campaigns c
          WHERE c.template_id = t.id
            AND c.workspace_id = t.workspace_id
            AND c.deleted_at IS NOT NULL
       )
 WHERE t.kind = 'system'
   AND t.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM campaigns c
      WHERE c.template_id = t.id
        AND c.workspace_id = t.workspace_id
        AND c.deleted_at IS NOT NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM campaigns o
      WHERE o.template_id = t.id
        AND o.workspace_id = t.workspace_id
        AND o.deleted_at IS NULL
   );
