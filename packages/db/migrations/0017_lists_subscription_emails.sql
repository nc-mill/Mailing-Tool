-- mlain:timeout=120

-- ===========================================================================
-- E-maily seznamu: rozloučení po odhlášení, cizí klíče na šablony
-- a přesměrování po potvrzení a po odhlášení.
--
-- PROČ TO VŠECHNO NAJEDNOU. Jsou to tři sloupce téže tabulky, které patří
-- k jednomu plánu (docs/superpowers/plans/2026-08-05-emaily-seznamu.md).
-- Tři samostatné migrace nad `lists` by znamenaly tři validační skeny téže
-- tabulky a tři čísla, o která se poperou souběžně rozpracované větve.
--
-- ---------------------------------------------------------------------------
-- 1. ROZLOUČENÍ PO ODHLÁŠENÍ
-- ---------------------------------------------------------------------------
-- `send_goodbye` má výchozí hodnotu `false` a je to rozhodnutí zadavatele
-- z 5. 8. 2026, ne opatrnost. Část odesílatelů rozloučení záměrně neposílá,
-- protože e-mail po odhlášení bývá vnímaný jako drzost, a existující seznamy
-- si o tom nikdo nikdy nezvolil. Zapnout se to musí vědomě.
--
-- `goodbye_template_id` je NULLABLE a `NULL` znamená „použije se obecné znění",
-- tedy konstanta typu Document v `packages/core/src/contacts/lists/default-emails.ts`.
-- Není to chybějící hodnota: obecné znění je plnohodnotný e-mail a seedovat ho
-- jako řádek ke každému projektu by znamenalo jeho kopii u každého zákazníka
-- a datovou migraci při opravě překlepu.
--
-- ---------------------------------------------------------------------------
-- 2. CIZÍ KLÍČE NA ŠABLONY, KTERÉ TU CHYBĚLY OD MIGRACE 0001
-- ---------------------------------------------------------------------------
-- `lists.confirmation_template_id` a `lists.welcome_template_id` existují od
-- první migrace, ale cizí klíč nemá ani jeden: jediný `REFERENCES templates`
-- v celém repozitáři byl do teď v `0015_forms_delivery_template.sql`. Smazaná
-- šablona tedy nechávala v seznamu viset neplatné ID a odeslání by nad ním
-- selhalo až za běhu.
--
-- ON DELETE SET NULL, ne RESTRICT ani CASCADE, ze stejného důvodu jako
-- u formulářů: smazaná šablona nesmí vzít s sebou seznam (ten je nositelem
-- souhlasů a přihlášení celého projektu), ale taky nesmí zůstat odkaz do
-- prázdna. Seznam se tím vrátí k obecnému znění, tedy k použitelnému stavu.
--
-- SLOUPCE SE NEJDŘÍV UKLIDÍ. Kdyby v nich už teď byla neplatná ID, cizí klíč
-- by se nedal vytvořit a migrace by spadla uprostřed. `UPDATE` je proto
-- podmínka platnosti, ne úklid navíc.
--
-- ---------------------------------------------------------------------------
-- 3. PŘESMĚROVÁNÍ PO POTVRZENÍ A PO ODHLÁŠENÍ
-- ---------------------------------------------------------------------------
-- Formulář už přesměrování umí (`forms.redirect_url`), potvrzovací stránka
-- a stránka odhlášení ne. `NULL` znamená „zůstane naše stránka", což je pro
-- drtivou většinu projektů správně: vlastní stránka musí mít text o tom, co se
-- právě stalo, a bez něj je přesměrování horší než žádné.
--
-- ---------------------------------------------------------------------------
-- GRANTY SE NEMĚNÍ. Migrace 0005 přiděluje práva na CELOU tabulku, ne na výčet
-- sloupců. POLITIKY RLS SE NEMĚNÍ: `ws_isolation` nad `lists` filtruje ŘÁDKY
-- podle `workspace_id`, ne sloupce.
--
-- POZOR NA STŘEDNÍK V `CHECK`. Generátor drizzle-kit si SQL dělí na příkazy
-- naivně a středník uvnitř těla omezení mu soubor uřízne uprostřed; vznikne
-- migrace, kterou nejde spustit, přestože snímek schématu vypadá v pořádku.
-- Omezení níž proto žádný nemají.
-- ===========================================================================
ALTER TABLE lists ADD COLUMN IF NOT EXISTS goodbye_template_id uuid;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS send_goodbye boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS confirm_redirect_url text;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS unsubscribe_redirect_url text;
--> statement-breakpoint

ALTER TABLE lists ADD CONSTRAINT ck_lists__confirm_redirect_url_len
  CHECK (confirm_redirect_url IS NULL OR char_length(confirm_redirect_url) BETWEEN 1 AND 2000);
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT ck_lists__unsubscribe_redirect_url_len
  CHECK (unsubscribe_redirect_url IS NULL OR char_length(unsubscribe_redirect_url) BETWEEN 1 AND 2000);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Úklid před cizím klíčem. Bez něj by osiřelé ID shodilo celou migraci.
-- ---------------------------------------------------------------------------
UPDATE lists SET confirmation_template_id = NULL
 WHERE confirmation_template_id IS NOT NULL
   AND confirmation_template_id NOT IN (SELECT id FROM templates);
--> statement-breakpoint
UPDATE lists SET welcome_template_id = NULL
 WHERE welcome_template_id IS NOT NULL
   AND welcome_template_id NOT IN (SELECT id FROM templates);
--> statement-breakpoint

ALTER TABLE lists ADD CONSTRAINT fk_lists__confirmation_template
  FOREIGN KEY (confirmation_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT fk_lists__welcome_template
  FOREIGN KEY (welcome_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT fk_lists__goodbye_template
  FOREIGN KEY (goodbye_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexy nad cizími klíči. Bez nich by mazání jedné šablony muselo kvůli
-- ON DELETE SET NULL projít celou tabulku seznamů, a to třikrát. Jsou
-- částečné: seznamů s vlastní šablonou je zlomek a řádky s NULL v indexu
-- k ničemu nejsou.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lists__confirmation_template
  ON lists (confirmation_template_id)
  WHERE confirmation_template_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lists__welcome_template
  ON lists (welcome_template_id)
  WHERE welcome_template_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lists__goodbye_template
  ON lists (goodbye_template_id)
  WHERE goodbye_template_id IS NOT NULL;
