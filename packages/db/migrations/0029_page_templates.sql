-- mlain:timeout=120

-- ===========================================================================
-- DESIGNOVATELNÉ VEŘEJNÉ STRÁNKY: nový druh šablony `page` a tři odkazy na ni
-- ze seznamu.
--
-- Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md
--
-- ---------------------------------------------------------------------------
-- 1. `templates.kind = 'page'`
-- ---------------------------------------------------------------------------
-- Stránka, kterou návštěvník uvidí po odeslání formuláře, po potvrzení
-- přihlášení nebo po odhlášení, je dokument z téhož editoru jako e-mail.
-- Ukládá se proto jako ŘÁDEK `templates`, ne jako pole ve formuláři: šablony
-- už mají verzování, knihovnu, náhledy, hlídání odkazů na obrázky
-- (`asset_references`), převalidaci po smazání kontaktního pole a audit.
-- Dokument schovaný v `forms.definition` by tohle všechno postrádal a druhá
-- kopie té mašinerie je horší než nová hodnota výčtu (rozhodnutí 4.1 plánu).
--
-- PROČ JE TO SAMOSTATNÁ HODNOTA, a ne `transactional`: `kind` určuje PROFIL,
-- kterým se dokument kontroluje. Stránka běží v prohlížeči na naší doméně,
-- takže má jinou paletu bloků než e-mail (bez patičky s odhlašovacím odkazem,
-- bez bloku syrového HTML, zdůvodnění v 4.4 plánu) a jiný obal výstupu.
-- Kdyby se schovala pod transakční šablonu, editor by nabízel bloky, které
-- vykreslení stránky odmítne, a naopak by vynucoval odhlašovací odkaz na
-- stránce, kde nemá co dělat.
--
-- Rozšíření výčtu je striktní nadmnožina, takže žádný existující řádek novou
-- podmínku porušit nemůže. Validační sken přes tabulku přesto proběhne, proto
-- timeout 120. Kontrakt 4.10.1 povoluje přidávat sloupce a indexy, omezení ne;
-- změna omezení je tady VĚDOMÁ, protože bez ní nejde stránku vůbec uložit.
--
-- ---------------------------------------------------------------------------
-- 2. Tři odkazy na stránku v `lists`
-- ---------------------------------------------------------------------------
-- Sloupce jdou VEDLE stávajících `confirm_redirect_url`,
-- `unsubscribe_redirect_url` a `already_subscribed_redirect_url`, protože
-- odpovídají na tutéž otázku „co uvidí návštěvník po tomhle kroku", jen jinou
-- odpovědí. Nové místo v datech by znamenalo, že se na jednu otázku odpovídá
-- ze dvou tabulek.
--
-- `NULL` ZNAMENÁ VESTAVĚNÝ TEXT, tedy přesně dnešní chování. Migrace proto
-- nemění ani jeden existující řádek: seznamy, které o stránky nepožádaly,
-- se chovají dál stejně.
--
-- Rozdělení podle plánu (oddíl 3): `unsubscribed` vlastní VÝHRADNĚ seznam,
-- protože se na odhlašovací stránku chodí z odkazu v e-mailu a není podle čeho
-- rozhodnout, který formulář by ji vlastnil. `confirmed`
-- a `already_subscribed` má nejdřív formulář (klíč v `forms.definition`)
-- a teprve když ho nemá, sáhne se na seznam. Děkovací stránka po odeslání
-- formuláře tady sloupec NEMÁ, a je to záměr: formulář ji vlastní sám a seznam
-- o ní nemá co rozhodovat.
--
-- ON DELETE SET NULL, ne RESTRICT ani CASCADE, ze stejného důvodu jako
-- u `confirmation_template_id` v migraci 0017: smazaná šablona nesmí vzít
-- s sebou seznam (ten je nositelem souhlasů celého projektu), ale taky nesmí
-- zůstat odkaz do prázdna. Seznam se tím vrátí k vestavěnému textu, tedy
-- k použitelnému stavu. Přihlášení ani odhlášení nikdy nesmí skončit chybou
-- proto, že si někdo smazal návrh: v tu chvíli už je člověk v databázi
-- a e-mail odeslaný.
--
-- SLOUPCE JSOU NOVÉ, takže v nich neplatné ID být nemůže a úklid před cizím
-- klíčem, jaký potřebovala migrace 0017, tady nemá co uklízet.
--
-- ---------------------------------------------------------------------------
-- GRANTY SE NEMĚNÍ A `mlain_apply_grants()` SE ZDE SCHVÁLNĚ NEOPISUJE.
-- ---------------------------------------------------------------------------
-- Migrace 0005 přiděluje práva na CELÉ tabulky `lists` a `templates`, ne na
-- výčet sloupců, takže se tabulkový grant vztahuje i na nové sloupce
-- automaticky. Opisovat funkci bez důvodu by znamenalo zbytečně převzít
-- odpovědnost za všechna práva v ní a přidat další místo, kde se dá vynecháním
-- práva o něco tiše přijít. Platná zůstává definice z migrace 0026.
--
-- POLITIKY RLS SE NEMĚNÍ. `lists` i `templates` mají politiku `ws_isolation`
-- (migrace 0004), která se ptá výhradně na `workspace_id` a filtruje ŘÁDKY,
-- ne sloupce. Nová hodnota `kind` ani nové sloupce na tom nic nemění.
--
-- POZOR NA STŘEDNÍK UVNITŘ `CHECK`. Generátor drizzle-kit si SQL dělí na
-- příkazy naivně a středník v těle omezení mu soubor uřízne uprostřed; vznikne
-- migrace, kterou nejde spustit, přestože snímek schématu vypadá v pořádku.
-- Omezení níž proto žádný nemá.
-- ===========================================================================
ALTER TABLE templates DROP CONSTRAINT IF EXISTS ck_templates__kind;
--> statement-breakpoint
ALTER TABLE templates
  ADD CONSTRAINT ck_templates__kind
  CHECK (kind IN ('campaign','transactional','system','page'));
--> statement-breakpoint

ALTER TABLE lists ADD COLUMN IF NOT EXISTS confirmed_template_id uuid;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS already_subscribed_template_id uuid;
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN IF NOT EXISTS unsubscribed_template_id uuid;
--> statement-breakpoint

ALTER TABLE lists ADD CONSTRAINT fk_lists__confirmed_template
  FOREIGN KEY (confirmed_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT fk_lists__already_subscribed_template
  FOREIGN KEY (already_subscribed_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT fk_lists__unsubscribed_template
  FOREIGN KEY (unsubscribed_template_id) REFERENCES templates(id) ON DELETE SET NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexy nad cizími klíči. Bez nich by mazání jedné šablony muselo kvůli
-- ON DELETE SET NULL projít celou tabulku seznamů, a to třikrát navíc.
-- Částečné: seznamů s vlastní stránkou je zlomek a řádky s NULL v indexu
-- k ničemu nejsou. Totéž pravidlo jako u indexů z migrace 0017.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lists__confirmed_template
  ON lists (confirmed_template_id)
  WHERE confirmed_template_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lists__already_subscribed_template
  ON lists (already_subscribed_template_id)
  WHERE already_subscribed_template_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lists__unsubscribed_template
  ON lists (unsubscribed_template_id)
  WHERE unsubscribed_template_id IS NOT NULL;
