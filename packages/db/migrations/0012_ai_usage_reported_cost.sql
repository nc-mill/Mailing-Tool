-- mlain:timeout=120

-- ===========================================================================
-- Skutečná účtovaná cena od poskytovatele, vedle našeho odhadu z ceníku.
--
-- PROČ. Do téhle chvíle uměla aplikace peníze jenom ODHADNOUT: vynásobila
-- tokeny sazbou z `packages/core/src/ai/pricing.json`. Odhad je ze své podstaty
-- vedle. Nezná slevu za čtení z mezipaměti, nezná výjimky z ceníku, které si
-- poskytovatel drží u konkrétního modelu, a nezná přirážku za dlouhý kontext.
--
-- OpenRouter přitom vrací SKUTEČNOU účtovanou částku v poli `usage.cost`
-- v každé odpovědi chat completions, bez parametru navíc a bez druhého
-- požadavku (doloženo 3. 8. 2026 na
-- https://openrouter.ai/docs/use-cases/usage-accounting). Tohle číslo je
-- pravdivější než jakýkoli náš součin, protože je to přesně to, co si
-- poskytovatel strhl. Sloupec `reported_cost` ho ukládá.
--
-- JEDNOTKA SE UKLÁDÁ S ČÁSTKOU, a je to podstata téhle migrace, ne detail.
-- Dokumentace OpenRouteru u `usage.cost` říká doslova „Cost in credits"
-- a NIKDE neuvádí, že jeden kredit je jeden dolar. Jinde v jejich dokumentaci
-- se u pole `total_cost` píše „USD", takže ta dvě místa si nejsou rovna a vztah
-- doložený není. Sloupec `reported_cost_unit` proto nese jméno jednotky
-- (dnes `openrouter_credit`) a nikde v aplikaci se z ní nedělají dolary.
-- Kdo doloží kurz, přidá převod a smí; kdo ho nedoloží, nesmí.
--
-- MĚNOVÝ TYP JE `numeric`, ne `double precision`. Peníze v plovoucí čárce se
-- při sčítání přes den rozejdou a rozdíl je vidět právě na malých částkách,
-- kterých je tu drtivá většina (jedna odpověď asistenta stojí setiny). Měřítko
-- 10 je zvolené podle toho, co poskytovatel skutečně posílá: účtuje po
-- jednotlivých tokenech, takže hodnoty typu 0.0000123 jsou běžné a zaokrouhlit
-- je na čtyři desetinná místa by z většiny řádků udělalo nulu.
--
-- SLOUPCE MEZIPAMĚTI JSOU V TÉŽE MIGRACI SCHVÁLNĚ. Bez nich nejde spočítat ani
-- odhad se zlevněnou sazbou: token přečtený z mezipaměti stojí u většiny
-- poskytovatelů zlomek ceny běžného vstupního tokenu a token do mezipaměti
-- zapsaný naopak víc. Dokud je neukládáme, počítá odhad všechny vstupní tokeny
-- plnou sazbou a u konverzace s dlouhým systémovým promptem střelí vysoko.
-- Druhá migrace kvůli dvěma sloupcům by stála další kolo bran a další nasazení.
--
-- VŠECHNY ČTYŘI SLOUPCE JSOU NULLABLE A BEZ DEFAULTU. Není to lenost, je to
-- rozdíl mezi „nula" a „nevíme". Řádky, které v tabulce leží ode dneška zpětně,
-- vznikly v době, kdy se cena ani mezipaměť nezapisovaly; kdyby dostaly
-- `DEFAULT 0`, tvrdily by, že poskytovatel účtoval nula a že se z mezipaměti
-- nečetlo nic. To by byla lež, kterou by už nikdo nerozpoznal. NULL říká
-- pravdu: tohle jsme tenkrát neměřili. Přidání nullable sloupce bez defaultu
-- je navíc v PostgreSQL čistá změna katalogu, takže existující řádky
-- nepřepisuje a tabulku neblokuje.
--
-- GRANTY SE NEMĚNÍ A JE TO OVĚŘENÉ, ne předpokládané. `mlain_apply_grants()`
-- z migrace 0005 dává na `ai_usage_daily` TABULKOVÝ grant
-- `SELECT, INSERT, UPDATE, DELETE` pro `mlain_app` (smyčka přes katalog na
-- začátku funkce). Sloupcový grant má jen sedm tabulek jmenovitě
-- (`web_events`, `message_events`, `contact_engagement`, `workspaces`,
-- `secret_key_generations`, `campaigns`, `messages`) a `ai_usage_daily` mezi
-- nimi není. Tabulkový grant se na nové sloupce vztahuje automaticky, takže
-- volat `mlain_apply_grants()` znovu není potřeba.
--
-- POLITIKY RLS SE NEMĚNÍ ZE STEJNÉHO DŮVODU. Migrace 0004 dává tabulce
-- politiku `ws_isolation`, která se ptá výhradně na `workspace_id`. Politika
-- filtruje ŘÁDKY, ne sloupce, takže nové sloupce spadají pod tutéž izolaci
-- projektů, aniž by se jí kdokoli musel dotknout.
-- ===========================================================================
ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS reported_cost numeric(20, 10);
--> statement-breakpoint
ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS reported_cost_unit text;
--> statement-breakpoint
ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS cache_read_tokens bigint;
--> statement-breakpoint
ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS cache_write_tokens bigint;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ČÁSTKA A JEDNOTKA JDOU VŽDYCKY SPOLU. Částka bez jednotky je číslo, o kterém
-- nikdo neví, co znamená, a přesně tak vzniká záměna kreditů za dolary: někdo
-- si to číslo jednou přečte, dosadí si k němu měnu podle citu a od té chvíle
-- to aplikace tvrdí uživateli. Omezení tu možnost odřezává na úrovni databáze,
-- takže se nedá obejít ani chybou v aplikaci, ani ručním UPDATE.
--
-- Záporná částka je zakázaná ze stejného soudku: poskytovatel dobropis tímhle
-- polem neposílá a záporný součet by v přehledu vypadal jako výdělek.
--
-- Existující řádky mají v obou sloupcích NULL, takže první větev omezení platí
-- a validace při přidání projde bez jediné opravy dat.
--
-- POZOR NA STŘEDNÍK UVNITŘ `CHECK`. Generátor drizzle-kit si SQL dělí na
-- příkazy naivně a středník v těle omezení mu soubor uřízne uprostřed; vznikne
-- migrace, kterou nejde spustit, přestože snímek schématu vypadá v pořádku.
-- V obou omezeních níž proto žádný není a kdo je bude upravovat, ať to tak
-- nechá.
-- ---------------------------------------------------------------------------
ALTER TABLE ai_usage_daily ADD CONSTRAINT ck_ai_usage_daily__reported_cost
  CHECK (
    (reported_cost IS NULL AND reported_cost_unit IS NULL)
    OR (reported_cost IS NOT NULL AND reported_cost_unit IS NOT NULL AND reported_cost >= 0)
  );
--> statement-breakpoint

-- Záporné tokeny jsou nesmysl v obou sloupcích. NULL projde, protože znamená
-- „neměřeno", ne nulu.
ALTER TABLE ai_usage_daily ADD CONSTRAINT ck_ai_usage_daily__cache_tokens
  CHECK (
    (cache_read_tokens IS NULL OR cache_read_tokens >= 0)
    AND (cache_write_tokens IS NULL OR cache_write_tokens >= 0)
  );
