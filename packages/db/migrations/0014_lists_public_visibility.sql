-- mlain:timeout=120

-- ===========================================================================
-- Veřejná viditelnost seznamu: nabízí se ve centru předvoleb, nebo ne.
--
-- PROČ. Veřejná stránka `/p/{token}` dosud vypisovala VŠECHNY seznamy projektu
-- a u každého zaškrtávátko. Držitel jakéhokoli odhlašovacího odkazu se tím mohl
-- sám přihlásit do libovolného seznamu, včetně takového, který znamená nárok:
-- „VIP", „Zákazníci se slevou". Kdo do seznamu nepatřil, si do něj mohl kliknout
-- a začít dostávat nabídky, na které nemá nárok. Není to kosmetika, je to
-- bezpečnostní vada: seznam je v tomhle systému nositelem oprávnění k rozesílce.
--
-- Druhá polovina téže vady je jmenná: příjemce viděl seznamy pojmenované tak,
-- jak si je pojmenoval správce („Novinky od 4. srpna 2026"). To je pracovní
-- poznámka, ne text pro příjemce, a někdy je to rovnou interní informace.
--
-- VÝCHOZÍ HODNOTA JE `false` A PLATÍ I PRO EXISTUJÍCÍ SEZNAMY. Je to jediná
-- bezpečná migrace: kdyby se existující seznamy zapnuly, migrace by tu vadu
-- zakonzervovala místo aby ji zavřela. Nabízet se smí jen to, co správce vědomě
-- nabídnout chtěl, takže po nasazení nenabízí projekt nic a správce si vybere.
-- Sloupec je proto NOT NULL s defaultem, ne nullable: „nevyplněno" tady nesmí
-- být třetí stav, protože o něm by se muselo pokaždé znovu rozhodovat.
--
-- ODHLÁŠENÍ TENHLE PŘÍZNAK NEŘÍDÍ A ŘÍDIT NESMÍ. Odhlásit se jde vždy, ze všeho
-- a bez ohledu na viditelnost. Je to zákonná povinnost, ne nastavení.
--
-- `public_name` A `public_description` JSOU NULLABLE SCHVÁLNĚ. NULL znamená
-- „správce veřejný text nenapsal" a aplikace v tom případě ukáže `name`.
-- Kdyby sloupce měly prázdný řetězec jako default, nešlo by ty dva stavy
-- rozlišit a nikdy by nešlo poznat, kde chybí text a kde je prázdný schválně.
--
-- GRANTY SE NEMĚNÍ. Migrace 0005 přiděluje práva na CELOU tabulku, ne na výčet
-- sloupců, takže se tabulkový grant vztahuje i na nové sloupce automaticky.
--
-- POLITIKY RLS SE NEMĚNÍ. Migrace 0004 dává tabulce `lists` politiku
-- `ws_isolation`, která se ptá výhradně na `workspace_id`. Politika filtruje
-- ŘÁDKY, ne sloupce, takže nové sloupce spadají pod tutéž izolaci projektů.
-- ===========================================================================
ALTER TABLE lists ADD COLUMN IF NOT EXISTS public_visible boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS public_name text;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS public_description text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Délky odpovídají tomu, k čemu ty texty jsou. Veřejný název má tentýž strop
-- jako `name` (120 znaků, `ck_lists__name_len`), protože je to jeho náhrada
-- v jiném jazyce, ne jiný druh údaje. Popis je věta pod zaškrtávátkem, ne
-- článek, takže 500 znaků.
--
-- Prázdný řetězec je zakázaný v obou. Kdyby prošel, vznikl by třetí stav vedle
-- NULL a vyplněné hodnoty a aplikace by musela pokaždé řešit, jestli
-- `public_name = ''` znamená „nevyplněno" nebo „schválně prázdné jméno".
-- Existující řádky mají NULL, takže první větev platí a validace při přidání
-- omezení projde bez jediné opravy dat.
--
-- POZOR NA STŘEDNÍK UVNITŘ `CHECK`. Generátor drizzle-kit si SQL dělí na
-- příkazy naivně a středník v těle omezení mu soubor uřízne uprostřed; vznikne
-- migrace, kterou nejde spustit, přestože snímek schématu vypadá v pořádku.
-- V obou omezeních níž proto žádný není a kdo je bude upravovat, ať to tak
-- nechá.
-- ---------------------------------------------------------------------------
ALTER TABLE lists ADD CONSTRAINT ck_lists__public_name_len
  CHECK (public_name IS NULL OR char_length(public_name) BETWEEN 1 AND 120);
--> statement-breakpoint

ALTER TABLE lists ADD CONSTRAINT ck_lists__public_description_len
  CHECK (public_description IS NULL OR char_length(public_description) BETWEEN 1 AND 500);
