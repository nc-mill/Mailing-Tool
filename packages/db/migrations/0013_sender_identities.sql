-- mlain:timeout=120

-- ===========================================================================
-- Pojmenované předvolby odesílatele.
--
-- PROČ VŮBEC. Kampaň drží pět údajů o odesílateli ve vlastních sloupcích:
-- `from_name`, `from_email`, `reply_to`, `provider_id` a `sender_domain_id`.
-- Uživatel je dnes vyplňuje u KAŽDÉ kampaně znovu a nemá je kde uložit,
-- přestože se ve valné většině kampaní neliší ani o písmeno. Tahle tabulka je
-- to místo: jedna řádka = jedna pojmenovaná sada těch pěti údajů, kterou si
-- uživatel vybere ze seznamu a kampaň se z ní předvyplní.
--
-- PROČ TABULKA A NE KLÍČ V `workspaces.settings`. Nastavení kampaní v JSONu už
-- existuje (`settings -> 'campaigns'`, viz `WorkspaceCampaignSettings`) a bylo
-- by lákavé přidat tam pole. Neuděláme to, a to ze čtyř důvodů, které JSON
-- neumí splnit ani při nejlepší vůli:
--
--   1. ODKAZY. Předvolba ukazuje na odesílací účet a na odesílací doménu.
--      V tabulce je to cizí klíč, takže databáze sama zaručí, že tam nestojí
--      identifikátor neexistujícího řádku. V JSONu je to řetězec, o kterém
--      nikdo neví, jestli ještě něco znamená, a zjistí se to až tím, že kampaň
--      neodejde.
--   2. SOUBĚH. Dvě uložení nastavení najednou znamenají u JSONu přepis celého
--      dokumentu, takže druhý zápis tiše zahodí první. U řádků se to stát
--      nemůže.
--   3. JEDNOZNAČNÁ VÝCHOZÍ. „Právě jedna výchozí předvolba na projekt" je
--      v tabulce částečný unikátní index, tedy pravidlo, které nejde obejít
--      ani souběhem, ani chybou v aplikaci. V JSONu je to kontrola v kódu.
--   4. IZOLACE. Řádek spadá pod `ws_isolation` jako všechno ostatní. JSON
--      v `workspaces` je chráněný taky, ale skrz tabulku, kterou čte a zapisuje
--      úplně jiná část aplikace, takže se sem přenáší její rizika.
--
-- Cena za tabulku je jedna migrace. Cena za JSON by byla platba v podobě
-- osiřelých odkazů, a ta se platí v provozu.
--
-- CO SE NEUKLÁDÁ: nic, co by kampaň dělalo závislou na téhle tabulce. Kampaň si
-- při výběru předvolby hodnoty ZKOPÍRUJE do svých pěti sloupců a od té chvíle
-- si žije po svém. Předvolba je předloha, ne zdroj pravdy, a smazání předlohy
-- proto nemá jak rozbít kampaň, která už odešla.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SLOŽENÝ UNIKÁTNÍ KLÍČ NA `sender_domains`. Není to ozdoba, je to nosník
-- kontroly „vybraná doména musí patřit k vybranému účtu".
--
-- Bez něj by tu kontrolu musela dělat aplikace dotazem před zápisem, a mezi tím
-- dotazem a zápisem je vždycky okno, ve kterém se doména stihne přesunout pod
-- jiný účet (`addDomain` má `ON CONFLICT DO UPDATE SET provider_id = ...`,
-- takže se to opravdu děje). Se složeným klíčem to kontroluje databáze při
-- KAŽDÉM zápisu a okno neexistuje.
--
-- `id` je samo o sobě primární klíč, takže trojice je unikátní triviálně.
-- Ohlášení té unikátnosti je přesto potřeba: cizí klíč v PostgreSQL míří jen na
-- sloupce kryté unikátním omezením nebo unikátním indexem, a bez něj skončí
-- `ADD CONSTRAINT ... FOREIGN KEY` chybou 42830.
--
-- `workspace_id` je v klíči schválně. Díky němu nese cizí klíč níž i to, že
-- předvolba a doména patří TÉMUŽ projektu, a nezáleží na tom, jestli si na to
-- aplikace vzpomene.
-- ---------------------------------------------------------------------------
ALTER TABLE sender_domains
  ADD CONSTRAINT uq_sender_domains__workspace_id_provider
  UNIQUE (workspace_id, id, provider_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sender_identities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Jméno předvolby, tedy to, co uživatel uvidí v rozbalovacím seznamu
  -- u kampaně. Není to adresa ani doména: „Newsletter", „Fakturace",
  -- „Podpora". Kdyby se seznam skládal z adres, nedaly by se rozlišit dvě
  -- předvolby s touž adresou a jiným jménem odesílatele.
  name text NOT NULL,
  from_name text NOT NULL,
  -- Ukládá se v malých písmenech, stejně jako `campaigns.from_email`. Kontrolu
  -- „patří do vybrané domény" dělá aplikační vrstva, protože porovnává obsah
  -- DVOU tabulek a to `CHECK` neumí; omezení níž hlídá jen tvar.
  from_email text NOT NULL,
  -- NULL znamená „stačí adresa odesílatele". Adresa pro odpovědi smí být mimo
  -- odesílací doménu a je to běžné: odesílá se z `newsletter@firma.cz`
  -- a odpovědi chodí do sdílené schránky u jiného poskytovatele.
  reply_to text,
  provider_id uuid NOT NULL,
  sender_domain_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- POZOR NA STŘEDNÍK UVNITŘ `CHECK`. Generátor drizzle-kit dělí SQL na příkazy
  -- naivně a středník v těle omezení mu soubor uřízne uprostřed; vznikne
  -- migrace, kterou nejde spustit, přestože snímek schématu vypadá v pořádku.
  -- V žádném z omezení níž proto není a kdo je bude upravovat, ať to tak nechá.
  CONSTRAINT ck_sender_identities__name
    CHECK (btrim(name) <> '' AND length(name) <= 120),
  CONSTRAINT ck_sender_identities__from_name
    CHECK (btrim(from_name) <> '' AND length(from_name) <= 200),
  -- Tvar adresy, ne její platnost. `LIKE '%_@_%.__%'` říká „něco, zavináč,
  -- něco, tečka, aspoň dva znaky", tedy zrovna tolik, aby se do sloupce nedalo
  -- uložit prázdno ani doménová část bez tečky. Skutečnou validaci dělá zod
  -- v API; omezení je poslední pojistka proti ručnímu UPDATE.
  CONSTRAINT ck_sender_identities__from_email
    CHECK (from_email = lower(from_email)
           AND from_email LIKE '%_@_%.__%'
           AND length(from_email) <= 254),
  CONSTRAINT ck_sender_identities__reply_to
    CHECK (reply_to IS NULL
           OR (reply_to = lower(reply_to)
               AND reply_to LIKE '%_@_%.__%'
               AND length(reply_to) <= 254))
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- JEDINÝ CIZÍ KLÍČ NA ÚČET I DOMÉNU NARÁZ, a je to celá kapitola o tom, co se
-- stane, když se doména nebo účet smaže.
--
-- Trojice `(workspace_id, sender_domain_id, provider_id)` míří na trojici
-- `(workspace_id, id, provider_id)` v `sender_domains`. Z toho plyne rovnou
-- trojí záruka, a ani jedna z nich nestojí na tom, že si na ni aplikace
-- vzpomene:
--
--   * doména existuje,
--   * doména patří k účtu, který je v předvolbě vybraný,
--   * obojí patří k témuž projektu jako předvolba.
--
-- SAMOSTATNÝ CIZÍ KLÍČ NA `sending_providers` TU SCHVÁLNĚ NENÍ. Byl by
-- nadbytečný: `sender_domains.provider_id` už na účet míří a klíč výš na tu
-- doménu, takže neexistující účet se sem nedostane ani oklikou. Druhý klíč by
-- jen zdvojil práci při mazání účtu.
--
-- `ON DELETE CASCADE` je zvolený proti `SET NULL` i proti `RESTRICT`:
--
--   * `RESTRICT` by znamenal, že doménu nejde odebrat, dokud si uživatel
--     nesmaže předvolby. To je otravné a k ničemu: předvolba je pohodlí, ne
--     doklad, takže by bránila úklidu kvůli datům, o která nikdo nestojí.
--   * `SET NULL` nejde, sloupce jsou NOT NULL, a nullable být nemají: předvolba
--     bez domény nebo bez účtu je poloprázdný formulář, který nemá co
--     předvyplnit, a v seznamu u kampaně by byl past.
--   * `CASCADE` je jediná varianta, po které nezůstane nic rozbitého. Předvolba
--     bez domény ztratila smysl, takže zmizí s ní.
--
-- SMAZÁNÍ ÚČTU spadne do téhož mechanismu, jen o krok delší cestou:
-- `sender_domains.provider_id` má `ON DELETE CASCADE` na `sending_providers`,
-- takže smazání účtu smaže jeho domény a ty vezmou předvolby s sebou.
--
-- ODESLANÉ KAMPANĚ TO NEDOTKNE. Kampaň má vlastní `from_name`, `from_email`,
-- `reply_to`, `provider_id` a `sender_domain_id`; z předvolby si je jen
-- ZKOPÍROVALA. Kaskáda tedy odnese předlohu, ne obsah kampaně. A `campaigns`
-- ostatně samo drží `sender_domain_id` s `ON DELETE RESTRICT`, takže doména
-- používaná kampaní se nesmaže vůbec.
-- ---------------------------------------------------------------------------
ALTER TABLE sender_identities
  ADD CONSTRAINT fk_sender_identities__domain
  FOREIGN KEY (workspace_id, sender_domain_id, provider_id)
  REFERENCES sender_domains (workspace_id, id, provider_id) ON DELETE CASCADE;
--> statement-breakpoint

-- Jméno předvolby je to, čím ji uživatel v seznamu pozná, takže dvě stejná
-- jména jsou vada, ne volba. Porovnává se bez ohledu na velikost písmen:
-- „Newsletter" a „newsletter" jsou v rozbalovacím seznamu k nerozeznání.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sender_identities__workspace_name
  ON sender_identities (workspace_id, lower(name));
--> statement-breakpoint

-- Právě jedna výchozí předvolba na projekt. Týž vzor jako
-- `uq_sending_providers__one_default`: částečný unikátní index je levnější než
-- trigger a na rozdíl od aplikační kontroly ho neobejde souběh.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sender_identities__one_default
  ON sender_identities (workspace_id) WHERE is_default;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sender_identities__workspace
  ON sender_identities (workspace_id, created_at DESC);
--> statement-breakpoint

-- Podpora cizího klíče výš. Bez indexu na odkazující straně dělá PostgreSQL při
-- každém smazání domény sekvenční sken téhle tabulky.
CREATE INDEX IF NOT EXISTS idx_sender_identities__domain
  ON sender_identities (workspace_id, sender_domain_id, provider_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Izolace projektů. Doslovné znění politiky `ws_isolation` z migrace 0004,
-- včetně `NULLIF(..., '')`: na spojení, kde se kontext někdy nastavil přes
-- SET LOCAL, vrací `current_setting` po commitu PRÁZDNÝ ŘETĚZEC a `''::uuid`
-- by skončilo chybou 22P02, tedy pádem místo prázdného výsledku.
--
-- `FORCE ROW LEVEL SECURITY` se nepoužívá ze stejného důvodu jako v 0004:
-- schéma vlastní `mlain_migrator`, aplikace běží pod `mlain_app`, takže na ni
-- RLS dopadá sama od sebe.
-- ---------------------------------------------------------------------------
ALTER TABLE sender_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_isolation ON sender_identities
  USING      (workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Odkaz kampaně na předvolbu, ze které se naposledy předvyplnila.
--
-- K ODESLÁNÍ NENÍ POTŘEBA. Sender čte `from_name` a `from_email` z kampaně
-- a o téhle tabulce neví. Sloupec je tu jen proto, aby obrazovka po znovu
-- načtení ukázala v rozbalovacím seznamu tutéž předvolbu, kterou uživatel
-- vybral, místo aby pokaždé začínala na „vlastní nastavení".
--
-- `ON DELETE SET NULL`, a je to ROZDÍL PROTI OSTATNÍM DVĚMA odkazům kampaně na
-- odesílání, které mají `RESTRICT`. Není to nedůslednost:
--
--   * `provider_id` a `sender_domain_id` jsou údaje, podle kterých se odesílá,
--     takže jejich zmizení pod odeslanou kampaní by byla ztráta dokladu;
--   * `sender_identity_id` je poznámka „tohle vzniklo z předvolby X". Když
--     předvolbu někdo smaže, poznámka ztratí význam, ale kampaň se tím nemění
--     ani o písmeno. `RESTRICT` by tu znamenal, že předvolbu použitou byť
--     v jediné staré kampani už nikdo nikdy nesmaže, což je přesně ta past,
--     kterou zadání zakazuje.
--
-- Sloupec je nullable a bez defaultu. NULL znamená „vyplněno ručně", ne nulu;
-- všechny existující kampaně tím říkají pravdu, protože předvolby v době jejich
-- vzniku neexistovaly. Přidání nullable sloupce bez defaultu je v PostgreSQL
-- čistá změna katalogu, takže se tabulka nepřepisuje ani neblokuje.
--
-- GRANTY SE NEMĚNÍ. `mlain_app` má na `campaigns` tabulkový
-- `SELECT, INSERT, UPDATE, DELETE` ze smyčky přes katalog v `mlain_apply_grants()`
-- a tabulkový grant platí i pro nové sloupce. `mlain_sender` má na `campaigns`
-- tabulkový `SELECT` (a sloupcový `UPDATE` jen na `status` a `pause_reason`),
-- takže nový sloupec smí číst a nesmí do něj psát, což je přesně žádaný stav.
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS sender_identity_id uuid
  REFERENCES sender_identities(id) ON DELETE SET NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Práva na novou tabulku. Volá se `mlain_apply_grants()` z migrace 0005, ne
-- ruční GRANT: ta funkce bere seznam tabulek Z KATALOGU, takže `sender_identities`
-- do něj spadne sama a dostane přesně totéž, co má každá jiná projektová
-- tabulka, tedy `SELECT, INSERT, UPDATE, DELETE` pro `mlain_app`.
--
-- Vedlejším účinkem je `REVOKE ALL` pro `mlain_sender`, `mlain_gdpr`
-- a `mlain_maintenance` na téže tabulce, a to je záměr, ne škoda. Sender
-- předvolby nepotřebuje: v okamžiku odesílání jsou hodnoty dávno zkopírované
-- v kampani. Kdyby na ně grant měl, potřeboval by i politiku `sender_bypass`,
-- protože workspace kontext nenastavuje, a rozšiřovat výjimku z izolace kvůli
-- datům, která se ke čtení nepotřebují, se nedělá.
--
-- Funkce je idempotentní (každý blok se otevírá `REVOKE ALL`), takže opakované
-- zavolání nic nerozbije. Přesně na tohle je stavěná.
-- ---------------------------------------------------------------------------
SELECT mlain_apply_grants();
