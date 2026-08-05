-- mlain:timeout=120

-- ===========================================================================
-- E-mail, který přijde člověku po vyplnění formuláře.
--
-- PROČ. Formulář dosud uměl kontakt jen zapsat a přihlásit. Tím se ale nedá
-- postavit nejběžnější důvod, proč si někdo formulář na web vůbec dává:
-- „nech mi adresu a já ti pošlu e-book". Ta zpráva s odkazem ke stažení musí
-- být na formuláři definovatelná, a to v editoru e-mailů, ne jako pevný text
-- v kódu. Rozhodnutí zadavatele z 5. 8. 2026.
--
-- ODKAZ NA ŠABLONU, NE VLASTNÍ KOPIE OBSAHU. Šablony mají editor, verzování,
-- validaci i kompilaci. Druhé úložiště obsahu na formuláři by znamenalo druhý
-- editor a druhou kompilaci, a e-book by šel poslat jen jako holý text.
--
-- ON DELETE SET NULL, ne RESTRICT ani CASCADE. Smazaná šablona nesmí vzít
-- s sebou formulář (ten sbírá kontakty dál a je vložený na cizím webu), ale
-- taky nesmí zůstat viset jako odkaz do prázdna. Formulář se tím vrátí do
-- stavu „přihlásí, ale nic neposílá", což je stav, ve kterém začínal, a
-- rozhraní na chybějící e-mail upozorní.
--
-- NULLABLE SCHVÁLNĚ. NULL znamená „formulář žádný e-mail neposílá" a je to
-- legitimní volba: formulář na sběr adres do newsletteru žádnou zprávu navíc
-- posílat nemá. Default se proto nedoplňuje, existující formuláře zůstávají
-- beze změny.
--
-- SLOUPEC `custom_css` SE NERUŠÍ, jen ho od téhle chvíle nikdo nečte. Vkládaný
-- formulář nesmí nést žádné CSS (rozhodnutí zadavatele z téhož dne), takže se
-- hodnota do vkládacího skriptu už nepředává. Mazat sloupec by znamenalo zahodit
-- data uživatelů kvůli změně, která je může chtít zpátky.
--
-- GRANTY SE NEMĚNÍ. Migrace 0005 přiděluje práva na CELOU tabulku, ne na výčet
-- sloupců, takže se tabulkový grant vztahuje i na nový sloupec automaticky.
--
-- POLITIKY RLS SE NEMĚNÍ. Migrace 0004 dává tabulce `forms` politiku
-- `ws_isolation`, která se ptá výhradně na `workspace_id`. Politika filtruje
-- ŘÁDKY, ne sloupce, takže nový sloupec spadá pod tutéž izolaci projektů.
--
-- ŽÁDNÝ `CHECK` TU NENÍ A NENÍ TO OPOMENUTÍ. Cizí klíč je silnější kontrola,
-- než jakou by omezení dokázalo napsat. Kdyby ho sem někdo přidával, ať v jeho
-- těle NEDÁVÁ STŘEDNÍK: generátor drizzle-kit si SQL dělí na příkazy naivně
-- a středník uvnitř `CHECK` mu soubor uřízne uprostřed. Vznikne migrace, kterou
-- nejde spustit, přestože snímek schématu vypadá v pořádku.
-- ===========================================================================
ALTER TABLE forms ADD COLUMN IF NOT EXISTS delivery_template_id uuid;
--> statement-breakpoint

ALTER TABLE forms ADD CONSTRAINT fk_forms__delivery_template
  FOREIGN KEY (delivery_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Index nad cizím klíčem. Bez něj by mazání šablony muselo kvůli ON DELETE
-- SET NULL projít celou tabulku formulářů. Je částečný: formulářů s e-mailem
-- je zlomek a řádky s NULL v indexu k ničemu nejsou.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_forms__delivery_template
  ON forms (delivery_template_id)
  WHERE delivery_template_id IS NOT NULL;
