-- mlain:timeout=120

-- ===========================================================================
-- Výchozí seznam do PROJEKTŮ, KTERÉ UŽ EXISTUJÍ.
--
-- PROČ TO NESTAČILO UDĚLAT V KÓDU. Zakládání výchozího seznamu přibylo do
-- `createWorkspace` 5. 8. 2026, takže platí jen pro projekty založené od té
-- chvíle. Každá existující instalace zůstala bez výchozího seznamu, a tím
-- pádem bez předvýběru při ručním přidání kontaktu i v průvodci importem.
-- Naměřeno v běžící instalaci: ani jeden z pěti seznamů neměl `is_default`.
-- Opatření, které nikde nefunguje, není opatření.
--
-- ---------------------------------------------------------------------------
-- CO SE NEDĚLÁ A PROČ: ŽÁDNÝ EXISTUJÍCÍ SEZNAM SE NEPOVYŠUJE NASLEPO
-- ---------------------------------------------------------------------------
-- Nabízelo se označit za výchozí prostě první seznam projektu. Neděláme to.
-- `is_default` řídí, co je předem zaškrtnuté při ručním přidání kontaktu, takže
-- povýšit seznam „VIP" znamená, že se do něj lidé začnou přidávat jedním
-- kliknutím a dostanou kampaň určenou pro VIP. To je rozhodnutí o tom, komu se
-- co posílá, a to za správce dělat nesmíme.
--
-- Zakládá se proto NOVÝ, PRÁZDNÝ seznam, přesně takový, jaký dostane každý
-- nový projekt. Nejhorší, co se může stát, je zaškrtávátko navíc, které si
-- správce odškrtne, a výchozí seznam si může kdykoli přehodit na jiný
-- (`POST /api/v1/lists/{id}/default`, na obrazovce seznamů „Nastavit jako
-- výchozí").
--
-- JEDINÁ VÝJIMKA je seznam, který se tak UŽ JMENUJE. Když si ho někdo založil
-- ručně, je jeho záměr zřejmý a druhý stejnojmenný by stejně neprošel přes
-- `uq_lists__workspace_name`.
--
-- ---------------------------------------------------------------------------
-- JMÉNO PODLE JAZYKA PROJEKTU, ne podle jazyka uživatele: seznam vidí celý tým
-- a přejmenovat ho jde na jeho detailu.
--
-- `confirmation_mode = 'one_step'` je doménová výchozí hodnota (rozhodnutí R2).
-- Hodnota v DDL je `two_step` a je to pojistka pro zápis mimo doménovou vrstvu;
-- kdyby se sem nedosadila, choval by se výchozí seznam jinak než každý další,
-- který si uživatel založí sám.
--
-- SMAZANÉ PROJEKTY SE VYNECHÁVAJÍ. Měkce smazaný projekt se obnovit dá, ale
-- zakládat mu teď seznam znamená zapisovat do dat, která nikdo nečte.
--
-- MIGRACE JE IDEMPOTENTNÍ: obě části se ptají na `NOT EXISTS` výchozího
-- seznamu, takže druhé spuštění neudělá nic.
--
-- RLS SE TU NEUPLATNÍ. Migrace běží pod `mlain_migrator`, tedy pod vlastníkem
-- schématu, a `FORCE ROW LEVEL SECURITY` se podle migrace 0004 vědomě
-- nepoužívá. Zápis napříč projekty je tedy možný a je to jediné místo, kde je
-- to v pořádku: doménový kód na to nemá a mít nesmí.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Seznam, který se tak už jmenuje, se jen povýší.
--
-- Poddotaz s `LIMIT 1` je POVINNÝ, ne opatrnost: kdyby měl projekt shodou
-- okolností „Odběratelé" i „Subscribers", povýšily by se oba a částečný
-- unikátní index `uq_lists__workspace_default` by migraci shodil na 23505.
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
-- 2. Zbylým živým projektům se seznam založí.
-- ---------------------------------------------------------------------------
INSERT INTO lists (workspace_id, name, opt_in, confirmation_mode, is_default)
SELECT w.id,
       CASE WHEN lower(w.locale) LIKE 'cs%' THEN 'Odběratelé' ELSE 'Subscribers' END,
       'double',
       'one_step',
       true
  FROM workspaces w
 WHERE w.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM lists d
      WHERE d.workspace_id = w.id AND d.is_default AND d.deleted_at IS NULL
   );
