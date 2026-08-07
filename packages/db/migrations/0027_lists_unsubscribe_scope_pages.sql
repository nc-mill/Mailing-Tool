-- mlain:timeout=120

-- ===========================================================================
-- Dvě nastavení seznamu, která v produktu chyběla: ROZSAH ODHLÁŠENÍ a VLASTNÍ
-- STRÁNKA PRO UŽ PŘIHLÁŠENÉHO.
--
-- ---------------------------------------------------------------------------
-- 1. `unsubscribe_scope`
-- ---------------------------------------------------------------------------
-- Do téhle chvíle rozhodovala o rozsahu odhlášení VÝHRADNĚ přítomnost `list_id`
-- v podepsaném tokenu (`contacts/public/unsubscribe.ts`). Kampaň posílá token
-- se seznamem, takže kliknutí na odhlašovací odkaz vždycky odhlásilo jen z toho
-- jednoho seznamu a odesílatel s tím nemohl nic udělat. Část odesílatelů to
-- chce naopak: jeden odkaz, jedno kliknutí, a od nás už nic. Rozhoduje o tom
-- SEZNAM, ze kterého e-mail odešel, protože jiné místo, kde by to šlo rozhodnout,
-- v datech není.
--
-- VÝCHOZÍ HODNOTA JE 'list' A PLATÍ I PRO EXISTUJÍCÍ SEZNAMY, protože to je
-- dnešní chování. Migrace, která by existující seznamy přepnula na 'global',
-- by beze slova změnila to, co se stane příjemci po kliknutí, a udělala by to
-- u projektů, které o to nikdy nepožádaly.
--
-- POZOR, TOHLE NENÍ JEN ROZSAH. Globální odhlášení navíc zakládá záznam do
-- `suppressions` pro CELÝ projekt (`contacts/lists/unsubscribe.ts`), tedy
-- adresu zablokuje napříč všemi seznamy i kampaněmi, kdežto odhlášení ze
-- seznamu ne. Volba tím mění i to, jestli se adresa zablokuje globálně, a
-- rozhraní to u té volby musí říct doslova, jinak si tím někdo omylem zablokuje
-- celou svou databázi kontaktů.
--
-- Sloupec je NOT NULL s defaultem, ne nullable: „nevyplněno" tady nesmí být
-- třetí stav, protože o něm by se muselo pokaždé znovu rozhodovat, a rozhodovalo
-- by se o tom, co se stane po kliknutí na odhlašovací odkaz.
--
-- ---------------------------------------------------------------------------
-- 2. `already_subscribed_redirect_url`
-- ---------------------------------------------------------------------------
-- Kam poslat člověka, který odešle přihlašovací formulář adresou, která už
-- v seznamu POTVRZENÁ je. Dnes dostane tutéž děkovací stránku jako nový
-- zájemce, takže mu produkt tvrdí „potvrďte si e-mail", i když potvrzovat
-- nemá co a žádný e-mail mu nepřijde (stavový automat u `confirmed` nic
-- neposílá, viz `lists/state-machine.ts`).
--
-- `NULL` ZNAMENÁ DNEŠNÍ CHOVÁNÍ a je to výchozí stav. Není to opatrnost, je to
-- bezpečnostní rozhodnutí a je třeba mu rozumět:
--
--   Odpověď formuláře je dnes JEDNOTNÁ schválně (`UNIFORM_RESPONSE`
--   v `contacts/forms/submit.ts`, rozhodnutí R9): ať adresa v databázi je nebo
--   není, ať je blokovaná nebo ne, formulář odpoví stejně. Kdyby se odpověď
--   lišila, stal by se z veřejného formuláře nástroj na zjišťování, kdo je
--   v databázi, a u citlivého oboru (léčba, dluhy, právo) je to reálná škoda.
--
--   Vlastní stránka pro už přihlášeného tenhle rozdíl ZE SVÉ PODSTATY prozradí:
--   je to jiná odpověď na známou adresu. Proto se nezapíná sama a proto je
--   výchozí `NULL`. Zapnutí je vědomé rozhodnutí správce, který ví, jaký obor
--   provozuje, a rozhraní ho u toho pole na ten následek upozorňuje.
--
-- Prázdný řetězec je zakázaný stejně jako u `confirm_redirect_url`: vedle NULL
-- a vyplněné adresy by byl třetí stav, o kterém by aplikace pokaždé musela
-- rozhodovat, jestli znamená „nevyplněno" nebo „schválně prázdná adresa".
-- Překlad prázdného pole na NULL dělá `emptyToNull` v `repo/lists.ts`.
--
-- ---------------------------------------------------------------------------
-- GRANTY SE NEMĚNÍ A `mlain_apply_grants()` SE ZDE SCHVÁLNĚ NEOPISUJE.
-- ---------------------------------------------------------------------------
-- Migrace 0005 přiděluje práva na CELOU tabulku `lists`, ne na výčet sloupců,
-- takže se tabulkový grant vztahuje i na nové sloupce automaticky. Opisovat
-- funkci bez důvodu by znamenalo zbytečně převzít odpovědnost za všechna práva
-- v ní a přidat další místo, kde se dá vynecháním práva o něco tiše přijít.
-- Platná zůstává definice z migrace 0026.
--
-- POLITIKY RLS SE NEMĚNÍ. `lists` má politiku `ws_isolation` (migrace 0004),
-- která se ptá výhradně na `workspace_id` a filtruje ŘÁDKY, ne sloupce.
--
-- POZOR NA STŘEDNÍK UVNITŘ `CHECK`. Generátor drizzle-kit si SQL dělí na
-- příkazy naivně a středník v těle omezení mu soubor uřízne uprostřed; vznikne
-- migrace, kterou nejde spustit, přestože snímek schématu vypadá v pořádku.
-- ===========================================================================
ALTER TABLE lists ADD COLUMN IF NOT EXISTS unsubscribe_scope text DEFAULT 'list' NOT NULL;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS already_subscribed_redirect_url text;
--> statement-breakpoint

-- Výčet hodnot patří do databáze, ne jen do zodu. Rozsah odhlášení rozhoduje
-- o tom, jestli se adresa zablokuje pro celý projekt, takže překlep v jiné
-- cestě zápisu (import, oprava dat ručně) nesmí skončit řádkem, kterému
-- aplikace nerozumí.
ALTER TABLE lists DROP CONSTRAINT IF EXISTS ck_lists__unsubscribe_scope;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT ck_lists__unsubscribe_scope
  CHECK (unsubscribe_scope IN ('list','global'));
--> statement-breakpoint

-- Táž délka jako u `confirm_redirect_url` a `unsubscribe_redirect_url`: je to
-- tentýž druh údaje, takže jiný strop by byl jen past při kopírování adresy.
ALTER TABLE lists DROP CONSTRAINT IF EXISTS ck_lists__already_subscribed_redirect_url_len;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT ck_lists__already_subscribed_redirect_url_len
  CHECK (already_subscribed_redirect_url IS NULL
         OR char_length(already_subscribed_redirect_url) BETWEEN 1 AND 2000);
