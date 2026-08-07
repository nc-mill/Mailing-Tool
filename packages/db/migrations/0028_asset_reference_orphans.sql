-- mlain:timeout=120

-- ===========================================================================
-- Úklid OSIŘELÝCH ODKAZŮ NA OBRÁZKY, tedy řádků `asset_references`, jejichž
-- vlastník už neexistuje.
--
-- ---------------------------------------------------------------------------
-- PROČ TO DATABÁZE NEUKLIDÍ SAMA
-- ---------------------------------------------------------------------------
-- `asset_references.ref_id` je POLYMORFNÍ: ukazuje střídavě na šablonu, na
-- verzi šablony, na kampaň a na profil značky. Na takový sloupec nejde dát
-- cizí klíč, takže tu žádná kaskáda není a nikdy nebyla. Integritu drží
-- výhradně aplikace (`syncAssetReferences` a `clearAssetReferences`
-- v `packages/core/src/templates/asset-references.ts`).
--
-- Komentář nad `assetUsage` tvrdil opak, tedy že se reference na smazanou
-- šablonu „maže kaskádou". Byla to nepravda a stála přesně za tímhle odpadem:
-- kdo si ji přečetl, vynechal v nové mazací cestě úklid odkazů. Opraveno
-- v `packages/core/src/assets/repository.ts`.
--
-- ---------------------------------------------------------------------------
-- ČÍM ODPAD VZNIKAL
-- ---------------------------------------------------------------------------
--  * `purgeDemoData` mazal ukázkové šablony a kampaně tvrdým `DELETE` mimo
--    mazací služby a odkazy po nich nechával. Opraveno v kódu, tahle migrace
--    dohání to, co vzniklo předtím.
--  * migrace 0021 dosypávala pracovním kopiím `deleted_at` holým `UPDATE`,
--    tedy taky mimo aplikaci.
--
-- ---------------------------------------------------------------------------
-- PROČ TO NENÍ KOSMETIKA
-- ---------------------------------------------------------------------------
-- `listPurgeCandidates` bere jen assety s `reference_count = 0`. Jediná
-- osiřelá reference proto zablokuje fyzický úklid obrázku NATRVALO a jeho
-- soubor v úložišti nesmaže nikdo nikdy. Uživateli se navíc v knihovně médií
-- ukáže „použito v:" a za tím nic, protože jméno smazaného vlastníka není
-- odkud vzít.
--
-- ---------------------------------------------------------------------------
-- CO SE MAZAT NESMÍ
-- ---------------------------------------------------------------------------
--  * ODKAZY VERZÍ ŠABLON, dokud verze existuje. Smazání šablony odkazy verzí
--    SCHVÁLNĚ nechává (`deleteTemplate`): verze je uložený důkaz, co přesně se
--    rozeslalo, a obrázek v ní použitý se nesmí zpod odeslaného e-mailu
--    ztratit. Verze se mažou až retencí, a s nimi odejdou i tyhle odkazy.
--  * NEZNÁMÝ `ref_type`. Kontrola `ck_asset_references__ref_type` pouští
--    jakýkoli malými písmeny psaný název, takže tabulka může nést druh
--    vlastníka, o kterém tahle migrace neví. Hádat, jestli je osiřelý, by
--    znamenalo mazat data podle dohadu, tak se takové řádky nechávají být
--    a upozorní na ně noční `content.verify_asset_refcounts`.
--
-- Měkce smazaná ŠABLONA i KAMPAŇ se naopak za vlastníka NEPOVAŽUJÍ, protože
-- obě mazací služby odkazy ruší v tomtéž kroku, ve kterém razítkují
-- `deleted_at`. Obnova je nerozbije: `restoreTemplate` si je zakládá znovu
-- z dokumentu, ne z toho, co v tabulce zbylo.
--
-- ---------------------------------------------------------------------------
-- `reference_count` SE SNIŽUJE PŘESNĚ O SMAZANÉ ŘÁDKY, NE PŘEPOČÍTÁVÁ
-- ---------------------------------------------------------------------------
-- Slepé dorovnání `reference_count = count(*)` by zahladilo i rozpory, které
-- s osiřelými odkazy nesouvisí. Ty má hlásit noční `content.verify_asset_refcounts`
-- a ta kontrola schválně NIC NEOPRAVUJE, aby se příčina dala najít. Migrace
-- proto ubere jen tolik, kolik sama smazala; jiný nesoulad nechá viditelný.
--
-- `GREATEST(..., 0)` je pojistka proti tomu, aby rozbitá historie nedala
-- záporný počet. Záporná hodnota by úklid assetů zablokovala napořád, tedy
-- přesně to, co tahle migrace odstraňuje.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCE A OPRÁVNĚNÍ
-- ---------------------------------------------------------------------------
-- Druhé spuštění nenajde žádný osiřelý řádek, smaže nula řádků a `UPDATE`
-- neprovede nic. Migrace nečte hodiny (konvence 2.4) a nezávisí na okamžiku
-- spuštění.
--
-- GRANTY SE NEMĚNÍ A `mlain_apply_grants()` SE ZDE SCHVÁLNĚ NEOPISUJE, ze
-- stejného důvodu jako v migraci 0027: nevzniká žádná tabulka ani sloupec,
-- takže není co přidávat, a opisovat celou funkci bez důvodu by jen přidalo
-- další místo, kde se dá vynecháním práva o něco tiše přijít. Platná zůstává
-- definice z migrace 0026.
--
-- POLITIKY RLS SE NEMĚNÍ. Migrace běží pod `mlain_migrator`, tedy pod
-- vlastníkem tabulky, na kterého se RLS nevztahuje; podmínky proto párují
-- `workspace_id` explicitně, aby se izolace neopírala o to, že odkaz přes
-- hranici projektu nikdy nevznikne.
-- ===========================================================================
WITH removed AS (
  DELETE FROM asset_references r
   WHERE (r.ref_type = 'template'
          AND NOT EXISTS (SELECT 1 FROM templates t
                           WHERE t.id = r.ref_id
                             AND t.workspace_id = r.workspace_id
                             AND t.deleted_at IS NULL))
      OR (r.ref_type = 'template_version'
          AND NOT EXISTS (SELECT 1 FROM template_versions v
                           WHERE v.id = r.ref_id
                             AND v.workspace_id = r.workspace_id))
      OR (r.ref_type = 'campaign'
          AND NOT EXISTS (SELECT 1 FROM campaigns c
                           WHERE c.id = r.ref_id
                             AND c.workspace_id = r.workspace_id
                             AND c.deleted_at IS NULL))
      OR (r.ref_type = 'brand_profile'
          AND NOT EXISTS (SELECT 1 FROM brand_profiles b
                           WHERE b.id = r.ref_id
                             AND b.workspace_id = r.workspace_id))
  RETURNING r.workspace_id, r.asset_id
), counted AS (
  SELECT workspace_id, asset_id, count(*)::int AS n
    FROM removed
   GROUP BY workspace_id, asset_id
)
UPDATE assets a
   SET reference_count = GREATEST(a.reference_count - c.n, 0)
  FROM counted c
 WHERE a.id = c.asset_id
   AND a.workspace_id = c.workspace_id;
