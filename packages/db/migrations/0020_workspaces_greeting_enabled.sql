-- ===========================================================================
-- VYPÍNAČ OSLOVENÍ A 5. PÁDU NA ÚROVNI PROJEKTU.
--
-- Rozhodnutí zadavatele z 5. 8. 2026: „V angličtině se vůbec neřeší 5. pád
-- a oslovení. Mělo by to být možné v nastavení celé vypnout a pak by se to
-- nezobrazovalo nikde."
--
-- ---------------------------------------------------------------------------
-- PROČ SLOUPEC, KDYŽ `workspaces.settings` JE JSONB
-- ---------------------------------------------------------------------------
-- Vypínač musí být v odpovědi `GET /api/v1/workspaces/{id}`, protože z ní čte
-- přes `getWorkspaceAccess()` úplně každá obrazovka. Ten endpoint vlastní
-- doména identity, a ta podle pravidla zapsaného v
-- `packages/core/src/contacts/settings.ts` NESMÍ parsovat větev
-- `settings.contacts`; každá doména parsuje jen svou. Uložení do jsonb by si
-- tedy vynutilo buď porušení toho pravidla, nebo druhý dotaz z každé obrazovky.
--
-- Navíc je to sourozenec `address_form`: mění se na téže obrazovce, týmž
-- `PATCH`, a je to tatáž jedna volba. Jednu polovinu do sloupce a druhou do
-- jsonb nedává smysl.
--
-- ---------------------------------------------------------------------------
-- DOSYPÁNÍ EXISTUJÍCÍCH PROJEKTŮ
-- ---------------------------------------------------------------------------
-- `DEFAULT true` je záměr: zapnuto je dosavadní chování a nový projekt nesmí
-- o funkci přijít mlčky. Projektům v jazyce, který 5. pád nemá, se ale vypíná,
-- protože přesně o nich je celé zadání. Seznam jazyků zrcadlí `VOCATIVE_LOCALES`
-- v `packages/core/src/contacts/naming/vocative.ts`.
--
-- NIC SE TÍM NEMAŽE. Sloupce `contacts.greeting`, `first_name_vocative`,
-- `vocative_locked` a spol. zůstávají naplněné a počítají se dál při každém
-- zápisu kontaktu. Přepnutí zpátky proto vrátí přesně to, co tam bylo, a je to
-- podmínka toho, aby se nerozbily šablony, které `{{ contact.greeting }}` už
-- obsahují: sloupec je pořád vyplněný, takže odeslaný e-mail vypadá stejně.
--
-- Měkce smazané projekty se dosypávají TAKÉ. `restoreWorkspace` je vrací do
-- provozu a nesmí je vrátit s nastavením, které nikdo nedohnal. Je to totéž
-- poučení jako z dvojice migrací 0018 a 0019.
--
-- Migrace je idempotentní: druhý běh přepíše tytéž hodnoty na tytéž hodnoty.
-- ===========================================================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS greeting_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint

UPDATE workspaces
   SET greeting_enabled = false
 WHERE lower(locale) NOT LIKE 'cs%'
   AND lower(locale) NOT LIKE 'sk%';
