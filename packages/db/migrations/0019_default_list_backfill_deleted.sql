-- mlain:timeout=120

-- ===========================================================================
-- Dokončení dosypání výchozího seznamu: I DO MĚKCE SMAZANÝCH PROJEKTŮ.
--
-- PROČ SAMOSTATNÁ MIGRACE A NE OPRAVA 0018. Runner migrací má drift guard:
-- „vydaná migrace se needituje ani o bílý znak" (`packages/db/src/migrate.ts`).
-- Kdyby se 0018 upravila na místě, každá instalace, která ji už aplikovala,
-- by skončila chybou `migration_hash_mismatch`. Opravené pravidlo proto jede
-- jako nová migrace, která dožene, co ta předchozí vynechala.
--
-- ---------------------------------------------------------------------------
-- KTERÁ PODMÍNKA PROJEKT VYNECHALA
-- ---------------------------------------------------------------------------
-- `WHERE w.deleted_at IS NULL` v migraci 0018. Napsal jsem ji s úvahou, že
-- zakládat seznam smazanému projektu znamená zapisovat do dat, která nikdo
-- nečte. Ta úvaha byla špatně, a to konkrétně:
--
--   MĚKKÉ SMAZÁNÍ JE VRATNÉ. `restoreWorkspace` projekt vrátí do provozu i se
--   všemi seznamy, kontakty a kampaněmi. Vrátil by ho ale BEZ VÝCHOZÍHO
--   SEZNAMU, tedy přesně do stavu, který tahle dvojice migrací opravuje, a už
--   by to nikdo nedohnal, protože obě migrace by byly dávno aplikované.
--
-- Naměřeno v běžící instalaci 5. 8. 2026: ze tří projektů zůstal po 0018 bez
-- výchozího seznamu jediný, a byl to právě ten se smazaným `deleted_at`.
--
-- Zápis do smazaného projektu je bezpečný: každá čtecí cesta filtruje podle
-- projektu, takže se řádek nikde neobjeví, a tvrdé smazání projektu ho vezme
-- s sebou kaskádou přes `lists.workspace_id`.
--
-- ---------------------------------------------------------------------------
-- Zbytek pravidla je stejný jako v 0018 a platí i tady:
--
--  * ŽÁDNÝ EXISTUJÍCÍ SEZNAM SE NEPOVYŠUJE NASLEPO. `is_default` řídí, co je
--    předem zaškrtnuté při ručním přidání kontaktu, takže povýšit „VIP" by
--    znamenalo, že se do něj lidé začnou přidávat jedním kliknutím a dostanou
--    kampaň určenou pro VIP. Zakládá se proto nový prázdný seznam, stejný,
--    jaký dostane každý nový projekt.
--  * Jediná výjimka je seznam, který se tak UŽ JMENUJE.
--  * Jméno podle jazyka projektu, `opt_in = 'double'` jako bezpečná výchozí
--    volba, `confirmation_mode = 'one_step'` jako doménová výchozí hodnota.
--
-- MIGRACE JE IDEMPOTENTNÍ a neudělá nic v projektu, který výchozí seznam už
-- má, takže se s 0018 nepere a druhé spuštění je bez následku.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Seznam, který se tak už jmenuje, se jen povýší. `LIMIT 1` je povinný:
-- dva stejně pojmenované by porušily částečný unikátní index
-- `uq_lists__workspace_default`.
-- ---------------------------------------------------------------------------
-- `updated_at` se ZÁMĚRNĚ nepřepisuje. Konvence 2.4 zakazuje čtení hodin
-- v migraci mimo DEFAULT: hodnota by pak závisela na okamžiku spuštění
-- a každá instalace by měla jinou. Sloupec si drží čas poslední SKUTEČNÉ
-- změny seznamu, což je pravdivější než razítko dosypání.
UPDATE lists AS l
   SET is_default = true
 WHERE l.deleted_at IS NULL
   AND lower(l.name) IN ('odběratelé', 'subscribers')
   AND NOT EXISTS (
     SELECT 1 FROM lists d
      WHERE d.workspace_id = l.workspace_id AND d.is_default AND d.deleted_at IS NULL
   )
   AND l.id = (
     SELECT c.id FROM lists c
      WHERE c.workspace_id = l.workspace_id
        AND c.deleted_at IS NULL
        AND lower(c.name) IN ('odběratelé', 'subscribers')
      ORDER BY c.created_at, c.id
      LIMIT 1
   );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Zbylým projektům se seznam založí. BEZ podmínky na `deleted_at`, viz
-- hlavička: měkce smazaný projekt se vrací do provozu a nesmí se vrátit
-- zmrzačený.
-- ---------------------------------------------------------------------------
INSERT INTO lists (workspace_id, name, opt_in, confirmation_mode, is_default)
SELECT w.id,
       CASE WHEN lower(w.locale) LIKE 'cs%' THEN 'Odběratelé' ELSE 'Subscribers' END,
       'double',
       'one_step',
       true
  FROM workspaces w
 WHERE NOT EXISTS (
     SELECT 1 FROM lists d
      WHERE d.workspace_id = w.id AND d.is_default AND d.deleted_at IS NULL
   );
