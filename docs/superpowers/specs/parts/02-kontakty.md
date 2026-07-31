# Část 2: Kontakty, segmenty a souhlasy

Vlastník: subagent part2-kontakty
Datum: 2026-07-31
Rozvíjí kapitoly hlavní specifikace: 5, 6.2, 6.3, 9 (GDPR)
Stav: koncept

Poznámka ke struktuře: oproti šabloně z kapitoly 7 zadání je vložena sekce 2 „Sladění s částí 1". Ostatní sekce jsou tím posunuté o jedno číslo.

Sladěno proti `parts/01-platforma.md` ze 2026-07-31. Konvence a kontrakty části 1 mají přednost před vším, co je v tomto dokumentu.

---

## 0. Pro netechnického recenzenta

### Co tahle část dělá

Vezmi si typický den marketérky Jany. Kolegyně z obchodu jí pošle excel s 3 200 adresami z veletrhu. Sloupec se jmenuje „Jméno" a je v něm „Ing. Pavel Novák", „Nováková Jana", „petr.dvorak@firma.cz" a u sto padesáti řádků je místo jména prázdno. Soubor je z českého Excelu, takže je oddělený středníky a v kódování, které při špatném otevření udělá z „Řehoř" nesmysl „Øehoø". Jana chce z toho seznamu do hodiny poslat newsletter, který začíná „Dobrý den, Pavle" a ne „Dobrý den Pavel".

Tahle část produktu je všechno, co se musí stát mezi tím excelem a okamžikem, kdy je seznam připravený k odeslání:

- **Nahrání a přečtení souboru.** Nástroj sám pozná kódování a oddělovač, ukáže náhled prvních dvaceti řádků a nechá Janu opravit, co uhodl špatně.
- **Rozdělení jména.** Z „Ing. Pavel Novák" udělá titul „Ing.", křestní jméno „Pavel" a příjmení „Novák". Z „Nováková Jana" pozná, že pořadí je obrácené.
- **Určení, jestli jde o muže nebo ženu, a spočítání 5. pádu.** „Pavel" → „Pavle", „Jana" → „Jano". Tam, kde si nástroj není jistý (třeba „Nikola" nebo „Nguyen Van Anh"), to řekne nahlas a nechá Janu rozhodnout, místo aby hádal.
- **Uložení kontaktů** včetně vlastních polí, která si Jana pojmenuje sama (město, velikost firmy, datum poslední objednávky).
- **Přihlašování do seznamů včetně potvrzovacího e-mailu** (takzvaný double opt-in: člověk se přihlásí, přijde mu e-mail s odkazem, a teprve kliknutím je opravdu přihlášený).
- **Odhlašování** a stránka, kde si příjemce sám nastaví, co chce dostávat.
- **Seznam zakázaných adres** (suppression list). Adresy, na které se nesmí posílat, protože e-mail neexistuje nebo protože si někdo stěžoval na spam. Bez tohohle Amazon zablokuje odesílací účet.
- **Segmenty.** Vytvoření skupin typu „ženy z Prahy, které za posledních 90 dní otevřely aspoň jeden e-mail a nemají štítek VIP", včetně živého počtu.
- **Souhlasy a GDPR.** Kdo kdy k čemu dal souhlas, jak ho odvolá, jak dostane výpis svých dat a jak se smaže.
- **Formuláře na web** a **příjem dat z e-shopu**, aby objednávka sama založila kontakt.

### Klíčová rozhodnutí a co znamenají pro uživatele

**1. Nástroj nikdy nehádá potichu.** Když si u oslovení není jistý, nepoužije ho. Pošle „Dobrý den" bez jména místo „Dobrý den, Nikolo" u muže. Zároveň Janě ukáže seznam „u 143 kontaktů si nejsme jistí" a nechá ji to opravit hromadně, ne po jednom.

*Co tím uživatel získá:* nikdy neodejde trapný e-mail.
*Co ztratí:* u části kontaktů bude oslovení neosobní, dokud je někdo neprojde.

**2. Ruční oprava se pamatuje pro celý projekt, ne jen pro jeden kontakt.** Když Jana jednou řekne, že „Nikola" je v jejím seznamu žena, platí to i pro všechny budoucí importy. Bez toho by ta kontrolní fronta byla nekonečný běžecký pás.

**3. Jméno a příjmení jsou dvě samostatná políčka, ne jedno.** Vypadá to jako drobnost, ale bez toho 5. pád spočítat nejde, protože křestní jméno a příjmení se skloňují jinak. Důsledek pro uživatele: při importu je vždy potřeba říct, který sloupec je co, případně nechat nástroj jedno pole rozdělit.

**4. Chybný řádek import nezastaví.** Když je v souboru deset rozbitých adres z tisíce, naimportuje se 990 kontaktů a Jana si stáhne soubor s těmi deseti řádky, opraví je a nahraje znovu. Alternativa (odmítnout celý soubor) je u marketingových dat nepoužitelná.

**5. Stejný soubor nahraný dvakrát nezaloží kontakty dvakrát.** Nástroj si pamatuje otisk souboru a upozorní. Kontakty se párují podle e-mailu.

**6. Odhlášení je vždy jedno kliknutí a nikdy nevyžaduje přihlášení.** To je nejen zákonná povinnost (souhlas musí jít odvolat stejně snadno, jak byl dán), ale i praktická obrana: člověk, který se nemůže odhlásit, klikne na „označit jako spam", a to poškodí doručitelnost všech dalších kampaní.

**7. Reklamace „označil jsem to jako spam" je nevratná.** Takovou adresu nejde v aplikaci odblokovat vůbec. Neexistující adresu (tvrdý bounce) může správce odblokovat až po 30 dnech a jednu po druhé. Je to schválně nepohodlné: hromadné odblokování je nejrychlejší cesta k zablokovanému odesílacímu účtu.

**8. Při výmazu osoby podle GDPR se nemažou statistiky kampaní.** Zmizí jméno, e-mail a všechny osobní údaje, ale zůstane informace, že „někdo" tehdy otevřel kampaň. Report, který včera ukazoval 4 812 otevření, ho ukazuje i po výmazu.

*Co tím uživatel získá:* čísla v reportech se zpětně nemění, což je podmínka toho, aby se jim dalo věřit.
*Co ztratí:* u smazaného člověka už nikdo nezjistí, že to byl právě on.

**9. Formulář na webu má ve výchozím stavu zapnuté potvrzování e-mailem.** Bez toho může kdokoliv přihlásit cizí adresu, a to je jak obtěžování, tak riziko stížností. Vypnout to jde, ale s výslovným varováním.

**10. Segmenty se nepřepočítávají v reálném čase.** Počet u segmentu je „k datu a času", ne živý. Když ale Jana pošle kampaň, publikum se počítá znovu a přesně v okamžik odeslání, takže nikdy neodejde na zastaralý seznam.

### Kompromisy vyjmenovaně

| Rozhodnutí | Uživatel získá | Uživatel ztratí |
|---|---|---|
| Vlastní pole se ukládají volně, ne jako pevné sloupce | Založí si nové pole za dvě vteřiny, bez zásahu do databáze | Filtrování podle vlastního pole je pomalejší; u projektů nad milion kontaktů je potřeba pole označit jako „často filtrované" (limit 8 na projekt) |
| Import běží na pozadí | Nezablokuje prohlížeč, jde zavřít okno | Výsledek není okamžitý; u 5 milionů řádků jde o desítky minut |
| Vokativ se počítá při uložení kontaktu, ne při odeslání | Co uvidí v náhledu, to se opravdu odešle; jde to zkontrolovat předem | Změna nastavení oslovení (vykání/tykání) spustí přepočet všech kontaktů, u milionu jde o jednotky minut na pozadí |
| Přesný počet segmentu se počítá dotazem do databáze | Vždy aktuální číslo | U složitých podmínek nad miliony kontaktů se místo přesného čísla zobrazí odhad („přibližně 12 000") s tlačítkem „spočítat přesně" |
| Potvrzovací odkaz v e-mailu vyžaduje ještě jedno kliknutí na stránce | Antispamové skenery, které automaticky otevírají odkazy v e-mailech, nemohou nikoho přihlásit místo něj | Jedno kliknutí navíc pro člověka. Jde přepnout na jedno kliknutí, per seznam |

### Co to znamená pro rychlost práce, provoz a náklady

**Rychlost práce.** Cesta „mám excel, chci poslat newsletter" má být pod deset minut včetně kontroly oslovení. Import 100 000 kontaktů má trvat do dvou minut, 5 milionů do 90 minut. Vlastní výpočet 5. pádu je změřeně 0,72 mikrosekundy na kontakt, takže na 5 milionů kontaktů je to 3,6 vteřiny procesorového času. Jinými slovy: čeština není to, co import zdržuje, zdržuje ho zápis do databáze.

**Provoz.** Nepřidává se žádná další služba. Žádný Redis, žádný Elasticsearch, žádná externí služba na rozpoznávání jmen ani na ověřování e-mailů. Všechno běží v PostgreSQL a v aplikaci. To drží slib „docker compose up a za pět minut to jede".

**Náklady.** Projekt s 5 miliony kontaktů zabere v databázi zhruba 2 GB dat a 2 GB indexů, tedy jednotky dolarů měsíčně za disk. Nejdražší položka nejsou kontakty, ale historie chování (tu vlastní část 5). Žádná knihovna v této části nic nestojí, všechny jsou zdarma a s licencí, která dovoluje komerční použití.

**Riziko.** Největší je právní, ne technické: co přesně se smí a nesmí posílat člověku, který dal souhlas přes cizí e-shop. Produkt umí souhlas zaznamenat, doložit a odvolat, ale nedokáže posoudit, jestli byl získán legálně. To musí zůstat na uživateli a mělo by to být napsané i v UI.

### Otázky pro recenzenta

1. **Neosobní oslovení u nejistých případů.** Souhlasíte, že u kontaktu, kde si nejsme jistí rodem, má odejít „Dobrý den" bez jména? Alternativa je použít nejlepší odhad a riskovat „Dobrý den, Nikolo" u muže. Kolik trapných oslovení je přijatelná cena za osobnější tón u zbytku?
2. **Kolik ruční práce je únosné.** U českého importu z veletrhu odhadujeme 3 až 8 procent kontaktů ve frontě ke kontrole. U seznamu s hodně cizími jmény (vietnamská, ukrajinská, arabská) to může být 20 až 40 procent. Je přijatelné, aby marketér u takového seznamu jednou proklikal několik set skupin jmen, nebo má nástroj v takovém případě nabídnout „vypnout oslovení jménem pro celý tento import"?
3. **Odblokování tvrdých bounců.** Navrhuji povolit odblokování až po 30 dnech a jen po jedné adrese. Není to na provoz moc přísné? Reálný případ: firma změní poštovní server, tisíc adres se dočasně odrazí, a zákazník je bude chtít vrátit hromadně.
4. **Potvrzovací odkaz na dvě kliknutí.** Výchozí nastavení je bezpečnější, ale sníží míru potvrzení odhadem o 5 až 15 procent. Má být výchozí bezpečná varianta, nebo ta s vyšší konverzí?
5. **Výmaz podle GDPR: mazat, nebo anonymizovat?** Navrhuji anonymizovat (kontakt zůstane jako prázdná skořápka, statistiky se nemění) a nabídnout tvrdé smazání jen vlastníkovi projektu. Souhlasíte, nebo má být výchozí tvrdé smazání?
6. **Zachování otisku smazané adresy.** Aby se smazaný člověk nedal omylem znovu naimportovat, potřebujeme si o něm nechat jednosměrný otisk e-mailu. Je to obhajitelné jako ochrana jeho práv, ale technicky je to pořád stopa po něm. Chcete to takhle, nebo má výmaz znamenat opravdu nulovou stopu s rizikem, že ho příští import vzkřísí?
7. **Formuláře a antispam třetích stran.** Turnstile a hCaptcha jsou nejúčinnější ochrana proti botům, ale posílají data návštěvníků cizí firmě, což je v rozporu se slibem „nulová komunikace s cizím cloudem". Navrhuji je nechat vypnuté a jasně označené. Je to dost, nebo má být ve výchozím stavu zapnutá vlastní, slabší ochrana?
8. **Kolik vlastních polí.** Navrhuji limit 100 vlastních polí na projekt a z toho 8 „rychle filtrovatelných". Sedí to na reálné použití, nebo je to málo?
9. **Presety čištění databáze.** Navrhuji šest hotových: nikdy neotevřel, nikdy neklikl, neaktivní 90+ dní, neotevřel posledních 5 kampaní, nepotvrzené přihlášení starší 30 dní, adresy s opakovanými měkkými odrazy. Chybí tam něco, co znáte z praxe?
10. **Kdo smí spustit výmaz.** Navrhuji, aby hromadné mazání kontaktů a nastavení retence směl jen vlastník projektu, ne editor. Souhlasíte?

---

## 1. Rozsah

### Co tato část vlastní

| Oblast | Obsah |
|---|---|
| Kontakty | Tabulka `contacts`, upsert politika, měkké mazání, anonymizace |
| Vlastní pole | `contact_fields`, typový systém, validace, koerce, indexace |
| Štítky | `tags`, `contact_tags` |
| Jména a oslovení | Rozdělení jména, tituly, určení rodu, český vokativ, `contact.greeting`, fronta ke kontrole, přepisy na úrovni projektu |
| Seznamy | `lists`, `list_subscriptions`, single i double opt-in, potvrzovací tokeny |
| Odhlášení | RFC 8058 one-click, stránka s preferencemi, pozastavení (snooze), rozsah per seznam versus globální |
| Suppression | `suppressions`, kdo ho plní, pravidla odebrání |
| Import | CSV import: detekce kódování a oddělovače, mapování, náhled, dávkování, chyby po řádcích, idempotence, obnova po pádu |
| Export | CSV export s kódováním vhodným pro Excel |
| Segmenty | JSON AST, validace, kompilace do SQL, náhled počtu, přepočet, statické segmenty |
| Presety | Hotové segmenty pro čištění databáze a reaktivaci |
| Formuláře | Embedovatelné formuláře, ochrana proti spamu, chování bez JavaScriptu |
| Souhlasy a GDPR | `consents`, aktuální stav souhlasu, přístup, přenositelnost, výmaz, omezení, námitka |
| Retence | Politiky retence pro data vlastněná touto částí |
| Příchozí webhooky | Deklarativní mapování cizího payloadu na kontakt |

### Co tato část vědomě nevlastní

| Oblast | Vlastní |
|---|---|
| Konvence DB, API, chyb, konfigurace, izolace projektů, role | Část 1 |
| Formát podepsaných tokenů a odvození klíče | Část 5 (viz 11.4), tato část ho jen používá |
| Merge tagy v šablonách, jejich katalog a validátor | Část 3 |
| Interpolace při odeslání | Část 4 (sender) |
| Výběr publika kampaně a materializace outboxu | Část 4, segmenty jsou jen vstup |
| Odesílání potvrzovacích a uvítacích e-mailů | Část 4, tato část jen zakládá požadavek |
| Klasifikace bounců a stížností | Část 4, tato část jen konzumuje výsledek do suppression |
| Web eventy, identity resolution, timeline | Část 5 |
| Statistiky otevření a kliknutí | Část 5, tato část je čte přes rollup tabulku (viz 11.5) |
| Odchozí webhooky (infrastruktura) | Část 1; tato část deklaruje jen obsah svých událostí |

---

## 2. Sladění s částí 1

Část 1 (`parts/01-platforma.md`, 2026-07-31) je vydaná. Její sekce označené **KONVENCE** a **KONTRAKT** mají přednost. Tato sekce obsahuje jen to, co po sladění zbývá: co se v tomto dokumentu kvůli části 1 změnilo, co je pořád otevřené a jak se plní požadavky, které část 1 vznesla na část 2.

### 2.1 Co se v tomto dokumentu změnilo podle části 1

| Oblast | Konvence části 1 | Změna zde |
|---|---|---|
| Verze DB | PostgreSQL **18**, `citext` jen pro e-maily (2.1) | Přijato. Každé `id uuid PRIMARY KEY` v sekci 3 znamená `id uuid PRIMARY KEY DEFAULT uuidv7()` |
| Pojmenování | `idx_<t>__<sl>`, `uq_<t>__<sl>`, `ck_<t>__<popis>`, `fk_<t>__<cíl>` (2.1) | Přijato, DDL v sekci 3 je přepsané |
| Primární klíče | UUIDv7, výjimka pro spojovací tabulky bez identity (2.1) | `contact_tags` má složený PK, všechny ostatní tabulky mají `uuid DEFAULT uuidv7()` bez výjimky |
| Měkké mazání | Jen u vyjmenovaných tabulek; unikátní indexy nad nimi jsou **částečné** `WHERE deleted_at IS NULL` (2.1) | Přijato. Měkce mažeme jen `contacts`, `lists` a `segments`, všechny tři jsou na seznamu části 1. `uq_contacts__workspace_email` je částečný, důsledky ve 4.1.7 |
| Délky textů | `text` bez limitu, limit vynucuje zod; `CHECK (length(...))` **jen** u indexovaných sloupců (2.1) | Přijato, `CHECK` na délku zůstal jen tam, kde sloupec vstupuje do indexu |
| Partitioning | Vždy `PARTITION BY RANGE (created_at)`, měsíčně, bez `DEFAULT` partition, zakládání jobem `platform.maintain_partitions` (2.1) | `inbound_deliveries` přejmenovalo `received_at` na `created_at` a přidává se do seznamu partitionovaných tabulek |
| Enumy | `text` + `CHECK`, nikdy nativní typ (2.1) | Shodné, beze změny |
| Časy | `timestamptz`, DB v UTC, `updated_at` udržuje aplikace (2.1) | Shodné |
| RLS | Každá tabulka s `workspace_id` má `ENABLE ROW LEVEL SECURITY` a politiku `ws_isolation`; kontext se nastavuje `set_config('openengage.workspace_id', ...)` na začátku transakce (3.6) | Přijato. Má to přímý dopad na kompilátor segmentů, viz 4.11.3 a 7.1 |
| Repository vrstva | Přímý import `db` mimo `packages/db` zakazuje ESLint; každá funkce bere branded `WorkspaceContext` (3.6) | Přijato. Kompilátor segmentů proto **žije uvnitř `packages/db/src/repo/segments.ts`**, ne v `packages/core`, viz 4.11.3 |
| Nastavení projektu | Doménová nastavení do `workspaces.settings.contacts`, tvar validuje zod z `packages/core/contacts` (2.4) | Shodné s 3.12. Vykání a tykání se **nečte** z našeho nastavení, ale ze sloupce `workspaces.address_form` |
| Chyby | RFC 9457 Problem Details, `application/problem+json`, strojový identifikátor je `code` v `lower_snake_case`, detaily v `errors[]` (4.2) | Přijato. Mapování doménových kódů na katalog části 1 je v 2.3 |
| Cesty a metody | Zdroje množné číslo, `kebab-case`, akce jako sloveso v pod-zdroji, `DELETE` vrací 204, bez koncového lomítka (4.1) | Přijato, endpointy v sekci 5 jsou přepsané |
| Tělo JSON | Klíče `snake_case`, neznámé klíče odmítnuté (`zod.strict()`), časy ISO 8601 UTC s milisekundami a `Z` (4.1) | Přijato. `ImportOptions` a `ImportMapping` v 4.6 jsou v `snake_case` |
| Stránkování | `{ data, pagination: { next_cursor, prev_cursor, has_more, limit } }`, parametr `order` ve tvaru `pole.směr`, celkový počet se v seznamech nevrací (4.3) | Přijato, můj původní `sort=-created_at` je nahrazený `order=created_at.desc` |
| Idempotence | `Idempotency-Key` povinná u vytvoření kontaktu a importu; fingerprint těla; 409 `idempotency_key_reuse` (4.4) | Přijato. Idempotence importu podle obsahu souboru z 4.6.9 je **druhá, nezávislá vrstva** nad tímto mechanismem, ne jeho náhrada |
| Limity requestu | JSON 1 MiB, CSV import 200 MiB, dávka 1 000 položek, timeout importu 120 s (4.1) | Shodné s limity v 4.6.1 a 5.1 |
| i18n | Katalogy `packages/i18n/messages/{locale}.json`, klíče `camelCase` v plné cestě, `en.json` je zdroj pravdy, ICU plurály (3.9) | Přijato. Klíče v 6.3 jsou `camelCase`, například `contacts.import.detected` |
| Systémové e-maily | Blokové šablony `system.<name>` per locale, seedované migrací; jazyk `contacts.locale` → `workspaces.locale` → `DEFAULT_LOCALE` → `en` (3.9) | Přijato, potvrzovací a uvítací e-mail jsou systémové šablony, viz požadavek 3.5 v sekci 11 |
| Sloupec jazyka | Část 1 v požadavku P2-2 mluví o **`contacts.locale`** | **Přejmenováno** z `contacts.locale` na `contacts.locale` v celém dokumentu |
| Audit | Akce `<entita>.<sloveso v minulém čase>`, registrace v `packages/core/contacts/audit.ts`, zápis ve stejné transakci (3.7) | Přijato, seznam v 7.5 |
| Rotace klíčů | Verzované klíče `<key_id>:<base64url>`, `SECRET_KEY_PREVIOUS` až 5 klíčů, doporučení staré klíče nikdy neodebírat (3.10) | Můj požadavek z 4.9.3 je **splněný**. Zbývá doplnit odhlašovací tokeny do tabulky dopadů rotace, viz požadavek 1.5 |

### 2.2 Jak plním požadavky části 1 na část 2

| ID | Požadavek části 1 | Kde je splněný |
|---|---|---|
| **P2-1** | Výčet polí kontaktu, která smí být kořenem merge tagu `contact.*`, jako typovaný union v `packages/contracts/src/liquid/contact-fields.ts` | 2.4 tohoto dokumentu (úplný seznam včetně pravidla pro vlastní pole) |
| **P2-2** | Formát `contacts.locale` a pravidlo, jak se určuje jazyk kontaktu | 2.5 tohoto dokumentu |
| **P2-3** | Registrace vlastních chybových kódů a názvů auditních akcí | Chybové kódy: 2.3 a 4.6.11. Auditní akce: 7.5. Obojí se zapíše do `packages/core/errors/registry.ts` a `packages/core/contacts/audit.ts` |
| **P2-4** | Definice payloadů událostí `contact.created`, `contact.subscribed`, `contact.unsubscribed` jako JSON schéma v `packages/contracts/webhooks/` | 4.14.7 (tabulka payloadů, ze které se schémata vygenerují) |
| všem | Registrace repository modulů do `isolation.matrix.test.ts` | `packages/db/src/repo/contacts.ts`, `lists.ts`, `segments.ts`, `suppressions.ts`, `consents.ts`, `imports.ts`, `forms.ts`, `inbound.ts` |

### 2.3 Mapování doménových kódů na katalog chyb části 1

Odpověď je vždy `application/problem+json` s polem `code` z katalogu části 1. Doménová příčina jde do `errors[].code`, u chyb bez konkrétního pole do `errors[0].path = "_"`.

| Situace | `code` (část 1) | HTTP | `errors[].code` |
|---|---|---|---|
| Neplatné tělo, adresa, hodnota pole | `validation_failed` | 422 | `invalid_email`, `email_too_long`, `invalid_number`, `invalid_boolean`, `invalid_date`, `invalid_enum_value`, `value_too_long`, `required_field_missing`, `unknown_field_key`, `field_key_reserved` |
| Kontakt už existuje při `on_conflict = "create"` | `already_exists` | 409 | |
| Duplicitní import téhož souboru | `conflict` | 409 | `import_duplicate` |
| Import už v projektu běží | `resource_locked` | 423 | `import_already_running` |
| Import není ve stavu `previewing` | `invalid_state_transition` | 409 | |
| Soubor nad 200 MiB | `payload_too_large` | 413 | |
| Segment: neplatný AST nebo operátor | `validation_failed` | 422 | `segment_invalid_ast`, `segment_operator_not_allowed`, `segment_invalid_range` |
| Segment: příliš složitý | `too_many_items` | 422 | `segment_too_complex`, `segment_too_deep`, `segment_cycle`, `segment_list_too_long` |
| Segment: odkaz na cizí nebo neexistující objekt | `not_found` | 404 | `segment_reference_not_found` |
| Přihlášení blokované suppression listem | `conflict` | 409 | `subscribe_blocked_suppressed`, `subscribe_blocked_complaint` |
| Suppression nejde odebrat | `forbidden` | 403 | `suppression_not_removable` |
| Tvrdý odraz mladší 30 dní | `conflict` | 409 | `suppression_too_recent` |
| Limit vlastních nebo indexovaných polí | `too_many_items` | 422 | `field_limit_reached`, `indexed_field_limit_reached` |
| Změna typu existujícího pole | `conflict` | 409 | `field_type_immutable` |
| Neověřená žádost GDPR | `forbidden` | 403 | `gdpr_not_verified` |
| Retence pod minimem | `validation_failed` | 422 | `retention_below_minimum` |
| Neplatný podpis příchozího webhooku | `signature_invalid` | 401 | |
| Původ formuláře mimo allowlist | `origin_not_allowed` | 403 | |
| Překročený rate limit | `rate_limited` | 429 | s `retry_after` |
| Limit kontaktů v projektu | `quota_exceeded` | 429 | `contact_limit_reached` |
| Náhled segmentu nedoběhl ani jako odhad | `dependency_timeout` | 504 | `segment_preview_timeout` |

Chybové kódy na úrovni řádku importu (4.6.11) se do HTTP odpovědi **nepromítají vůbec**. Import je asynchronní, řádkové chyby žijí v `import_errors.error_code` a v `imports.error_summary` a používají stejnou `lower_snake_case` konvenci.

### 2.4 Povolený kořen merge tagu `contact.*` (odpověď na P2-1)

```ts
// packages/contracts/src/liquid/contact-fields.ts
export const CONTACT_MERGE_FIELDS = [
  'email',
  'first_name',
  'last_name',
  'middle_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'first_name_vocative',
  'last_name_vocative',
  'greeting',
  'locale',
  'created_at',
] as const;

export type ContactMergeField = (typeof CONTACT_MERGE_FIELDS)[number];
```

Pravidla pro validátor části 3:

- `{{ contact.<X> }}` je platné, právě když `X ∈ CONTACT_MERGE_FIELDS`.
- Vlastní pole se adresují **výhradně** přes prefix `attr`: `{{ contact.attr.<key> }}`, kde `<key>` musí existovat v `contact_fields` daného projektu a nesmí být archivované. Prefix existuje proto, aby vlastní pole nikdy nemohlo zastínit systémové ani rozbít validátor, když si uživatel založí pole s klíčem `greeting`.
- `status`, `source`, `attributes`, `vocative_confidence`, `processing_restricted`, `email_hash` a všechny sloupce s `_at` kromě `created_at` jsou **záměrně mimo** seznam. Jsou to interní údaje, které nemají co dělat v těle e-mailu.
- Seznam je zároveň zdrojem pro extrakci polí do `messages.render_data` (kontrakt 4.10.1 části 1).

### 2.5 Jazyk kontaktu (odpověď na P2-2)

Sloupec: `contacts.locale text NOT NULL DEFAULT 'cs'`.

| Vlastnost | Hodnota |
|---|---|
| Formát | BCP 47 v podmnožině `^[a-z]{2}(-[A-Z]{2})?$`, tedy `cs`, `en`, `sk`, `pl`, `de`, případně `en-GB` |
| `NOT NULL` | ano, výchozí `workspaces.locale`; nikdy NULL, aby nikdo nemusel řešit fallback na úrovni dotazu |
| Zdroj hodnoty, v pořadí priority | 1. explicitní sloupec v importu, poli API, poli formuláře nebo mapování webhooku; 2. `Accept-Language` návštěvníka při odeslání formuláře, zúžený na podporované jazyky; 3. `workspaces.locale` |
| Kde se používá | veřejné stránky (potvrzení, odhlášení, preference), systémové e-maily (potvrzení double opt-in, uvítací), jazyk kampaně, `contact.greeting` |
| Vliv na vokativ | Modul odvození jména se řídí `locale`. Pro `cs` a `sk` počítá vokativ, pro ostatní vrací nominativ a `greeting` funguje beze změny (kapitola 6.3 hlavní specifikace) |
| Změna hodnoty | Přepočítá `greeting` u daného kontaktu |
| Neznámý jazyk | Hodnota mimo `SUPPORTED_LOCALES` se uloží, ale pro výběr šablony se použije `workspaces.locale`. Neodmítáme ji, protože import z cizího CRM běžně nese `fr-CA` a odmítnutí celého řádku kvůli jazyku by bylo nepřiměřené |

### 2.6 Co zůstává otevřené

| # | Otevřená věc | Kdo rozhodne |
|---|---|---|
| A | Rozšíření **`pg_trgm`** a **`btree_gin`**. Část 1 v 2.1 povoluje jen `citext`. Bez nich není fulltextové hledání kontaktu. Náhradní řešení a dopad jsou v požadavku 1.1 až 1.3 v sekci 11 | část 1 |
| B | Proměnná **`SUPPRESSION_HASH_KEY`** jako **nerotovatelná**. Konvence části 1 odvozuje všechny klíče ze `SECRET_KEY` přes HKDF, což u otisků vymazaných adres nefunguje, protože rotace by je zneplatnila. Požadavek 1.4 | část 1 |
| C | Role **`openengage_gdpr`** s právem `DELETE ON consents`. Část 1 v 2.1 odebírá aplikační roli `UPDATE` a `DELETE` na `consents`, což je správně, ale výmaz podle čl. 17 je pak neproveditelný. Požadavek 1.8 | část 1 |
| D | **Read-only pool** s možností nastavit `statement_timeout` per dotaz, pro náhled segmentu. Požadavky 1.6 a 1.7 | část 1 |
| E | Veřejné cesty **`/s/c/**`, `/p/**`, `/r/**`**. Část 1 v 4.1 vyjmenovává jen `/t/**`, `/e/**`, `/u/**`, `/f/**`. Požadavek 1.13 | část 1 |
| F | Zařazení **`inbound_deliveries`** mezi partitionované tabulky obsluhované jobem `platform.maintain_partitions`. Požadavek 1.14 | část 1 |
| G | Kompilátor segmentů generuje **dynamické SQL uvnitř repository vrstvy**. Potřebuje výjimku z pravidla „repository funkce nepřijímá řetězec", protože AST je uživatelský vstup. Zdůvodnění a obrana jsou v 4.11.3 | část 1 |

---

## 3. Datový model

### 3.1 Kontakty

```sql
CREATE TABLE contacts (
  id                      uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id            uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  email                   citext      NOT NULL,
  email_hash              bytea       NOT NULL,          -- HMAC-SHA256(SUPPRESSION_HASH_KEY, lower(email))
  email_domain            text        GENERATED ALWAYS AS (lower(split_part(email::text, '@', 2))) STORED,

  status                  text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','unconfirmed','unsubscribed','bounced','complained','deleted')),
  processing_restricted   boolean     NOT NULL DEFAULT false,   -- GDPR čl. 18

  first_name              text,       -- délku vynucuje zod (100), sloupec není v indexu
  last_name               text,
  middle_name             text,
  title_prefix            text,
  title_suffix            text,

  gender                  text        NOT NULL DEFAULT 'unknown'
    CHECK (gender IN ('female','male','unknown')),
  gender_source           text        NOT NULL DEFAULT 'none'
    CHECK (gender_source IN ('explicit','workspace_override','surname_rule',
                             'surname_rule_translit','given_name_dict','library_heuristic','manual','none')),

  first_name_vocative     text,
  last_name_vocative      text,
  vocative_confidence     text        NOT NULL DEFAULT 'none'
    CHECK (vocative_confidence IN ('high','low','none')),
  vocative_locked         boolean     NOT NULL DEFAULT false,
  vocative_locked_for     text,                                  -- 'first|last' v době zamknutí
  vocative_reviewed_at    timestamptz,
  vocative_reviewed_by    uuid,

  greeting                text        NOT NULL DEFAULT '',       -- hotové oslovení, viz 4.4.7
  greeting_neutral        text        NOT NULL DEFAULT '',       -- oslovení bez jména, viz 4.4.7
  name_split_confidence   text        NOT NULL DEFAULT 'none'
    CHECK (name_split_confidence IN ('high','low','none')),

  attributes              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  locale                  text        NOT NULL DEFAULT 'cs',
  timezone                text,

  source                  text        NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','api','form','webhook','double_opt_in','migration')),
  source_ref              text,                                  -- id importu, formuláře, endpointu

  last_activity_at        timestamptz,                           -- udržuje část 5
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  anonymized_at           timestamptz,

  search_text             text GENERATED ALWAYS AS (
    lower(coalesce(email::text,'') || ' ' || coalesce(first_name,'') || ' ' || coalesce(last_name,''))
  ) STORED,

  CONSTRAINT ck_contacts__status CHECK (status IN
    ('active','unconfirmed','unsubscribed','bounced','complained','deleted')),
  CONSTRAINT ck_contacts__gender CHECK (gender IN ('female','male','unknown')),
  CONSTRAINT ck_contacts__locale CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- email a search_text jsou v indexu, proto u nich limit hlídá i databáze (konvence 2.1 části 1)
  CONSTRAINT ck_contacts__email_len CHECK (char_length(email::text) BETWEEN 3 AND 254),
  CONSTRAINT ck_contacts__attributes_object CHECK (jsonb_typeof(attributes) = 'object'),
  CONSTRAINT ck_contacts__attributes_size CHECK (pg_column_size(attributes) <= 65536)
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON contacts
  USING      (workspace_id = current_setting('openengage.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('openengage.workspace_id', true)::uuid);
```

Inline `CHECK` u `status`, `gender` a `gender_source` v těle sloupce je v ukázce ponechaný kvůli čitelnosti; v migraci se zapisují jako pojmenovaná omezení `ck_contacts__<popis>` podle konvence 2.1 části 1. Politiku `ws_isolation` má **každá** tabulka této části se sloupcem `workspace_id`; u dalších tabulek se už neopakuje.

Indexy a proč existují:

```sql
-- 1. Klíč pro upsert a jediné místo, kde se kontakt hledá podle e-mailu.
--    Částečný podle konvence 2.1 části 1: měkce smazaný kontakt nesmí blokovat nové přihlášení
--    téže adresy. Důsledky pro upsert a obnovu jsou ve 4.1.7.
CREATE UNIQUE INDEX uq_contacts__workspace_email ON contacts (workspace_id, email)
  WHERE deleted_at IS NULL;

-- 2. Výchozí řazení v seznamu kontaktů + kurzorové stránkování (keyset na (created_at, id)).
CREATE INDEX idx_contacts__ws_created ON contacts (workspace_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- 3. Filtr podle stavu v seznamu i v segmentech ("aktivní", "odhlášení").
CREATE INDEX idx_contacts__ws_status_created ON contacts (workspace_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- 4. Preset "neaktivní 90+ dní" a řazení podle poslední aktivity.
CREATE INDEX idx_contacts__ws_last_activity ON contacts (workspace_id, last_activity_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- 5. Fulltextové hledání v UI (e-mail, jméno, příjmení). btree_gin dovolí uuid do stejného indexu,
--    takže dotaz nikdy neprochází cizí projekty.
CREATE INDEX idx_contacts__search_trgm ON contacts
  USING gin (workspace_id, search_text gin_trgm_ops);

-- 6. Rovnostní a containment predikáty nad vlastními poli v segmentech.
--    jsonb_path_ops je menší a rychlejší než výchozí jsonb_ops a stačí na operátor @>.
CREATE INDEX idx_contacts__attributes_gin ON contacts
  USING gin (attributes jsonb_path_ops);

-- 7. Fronta ke kontrole vokativu. Částečný index, typicky jednotky procent tabulky,
--    takže je malý a dotaz na frontu je index-only.
CREATE INDEX idx_contacts__ws_vocative_review ON contacts (workspace_id, created_at DESC)
  WHERE vocative_confidence = 'low' AND vocative_locked = false AND deleted_at IS NULL;

-- 8. Doména e-mailu: operátor matches_domain v segmentech a analýza doručitelnosti.
CREATE INDEX idx_contacts__ws_email_domain ON contacts (workspace_id, email_domain)
  WHERE deleted_at IS NULL;

-- 9. Hledání podle otisku e-mailu při kontrole suppression po výmazu.
CREATE INDEX idx_contacts__ws_email_hash ON contacts (workspace_id, email_hash);

-- 10. Kurzorový průchod celým projektem podle id: materializace publika kampaně po dávkách
--     (WHERE workspace_id = $1 AND id > $2 ORDER BY id), hromadné mazání, export, přepočty.
--     Bez něj by dotaz sedl na primární klíč a procházel i cizí projekty, než by je zahodil.
CREATE INDEX idx_contacts__ws_id ON contacts (workspace_id, id)
  WHERE deleted_at IS NULL;
```

Indexy na míru pro vlastní pole (viz 4.2.4) se zakládají za běhu jako částečné výrazové indexy:

```sql
-- Zakládá se přes CREATE INDEX CONCURRENTLY, jméno je odvozené z (workspace_id, key).
CREATE INDEX CONCURRENTLY idx_contacts__attr_<hash>
  ON contacts ((attributes ->> 'order_total'))
  WHERE workspace_id = '<uuid>';
```

Odhad velikosti při 5 000 000 kontaktech v jednom projektu (průměr 380 B užitečných dat na řádek, 12 vlastních polí):

| Objekt | Velikost |
|---|---|
| Heap `contacts` | ~2,4 GB |
| `uq_contacts__workspace_email` | ~330 MB |
| `idx_contacts__ws_created` | ~300 MB |
| `idx_contacts__ws_status_created` | ~320 MB |
| `idx_contacts__ws_last_activity` | ~300 MB |
| `idx_contacts__search_trgm` | ~900 MB |
| `idx_contacts__attributes_gin` | ~600 MB |
| `idx_contacts__ws_id` | ~230 MB |
| Ostatní indexy | ~450 MB |
| **Celkem** | **~5,8 GB** |

### 3.2 Vlastní pole a štítky

```sql
CREATE TABLE contact_fields (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key           text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label         jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { "cs": "Město", "en": "City" }
  description   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  type          text        NOT NULL
    CHECK (type IN ('text','long_text','number','boolean','date','datetime',
                    'enum','multi_enum','url','email','phone')),
  options       jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- viz 4.2.2
  required      boolean     NOT NULL DEFAULT false,
  subject_editable boolean  NOT NULL DEFAULT false,          -- smí měnit subjekt v preferencích
  indexed       boolean     NOT NULL DEFAULT false,
  index_state   text        NOT NULL DEFAULT 'none'
    CHECK (index_state IN ('none','building','ready','failed')),
  position      int         NOT NULL DEFAULT 0,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Klíč je stabilní identifikátor v merge tagu {{ contact.<key> }}, musí být jedinečný i po archivaci,
-- aby archivované pole nešlo přepsat novým se stejným klíčem a jiným typem.
CREATE UNIQUE INDEX uq_contact_fields__workspace_key ON contact_fields (workspace_id, key);
CREATE INDEX idx_contact_fields__ws_position ON contact_fields (workspace_id, position)
  WHERE archived_at IS NULL;
```

`contact_fields.archived_at` **není měkké mazání** a proto se nejmenuje `deleted_at`. Archivované pole je živý záznam: jeho hodnoty v `attributes` zůstávají, segmenty na něj dál fungují a merge tagy se jen přestanou nabízet. Tabulka proto není na seznamu měkce mazaných tabulek v 2.1 části 1 a její unikátní index je záměrně **úplný**, aby se klíč archivovaného pole nedal znovu použít s jiným typem.

```sql
CREATE TABLE tags (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  color         text        CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Štítky se v UI zadávají volným textem, kolize na velikosti písmen je nejčastější chyba.
CREATE UNIQUE INDEX uq_tags__workspace_name ON tags (workspace_id, lower(name));

CREATE TABLE contact_tags (
  contact_id    uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id        uuid        NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);
-- Segment "má štítek X" jde od štítku ke kontaktům, proto obrácený index.
CREATE INDEX idx_contact_tags__tag ON contact_tags (tag_id, contact_id);
```

`workspace_id` je na `contact_tags` redundantní (plyne z kontaktu), ale je tam schválně: pravidlo z kapitoly 5 hlavní specifikace říká, že každá tabulka nese `workspace_id`, a kompilátor segmentů díky tomu nemusí joinovat zpět na `contacts`.

### 3.3 Seznamy a přihlášení

```sql
CREATE TABLE lists (
  id                        uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id              uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                      text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description               text,
  opt_in                    text        NOT NULL DEFAULT 'double' CHECK (opt_in IN ('single','double')),
  confirmation_mode         text        NOT NULL DEFAULT 'two_step'
                                          CHECK (confirmation_mode IN ('one_step','two_step')),
  confirmation_ttl_hours    int         NOT NULL DEFAULT 168 CHECK (confirmation_ttl_hours BETWEEN 1 AND 720),
  confirmation_template_id  uuid,       -- vlastní část 3
  welcome_template_id       uuid,
  send_welcome              boolean     NOT NULL DEFAULT false,
  confirmation_max_resends  smallint    NOT NULL DEFAULT 3 CHECK (confirmation_max_resends BETWEEN 0 AND 10),
  is_default                boolean     NOT NULL DEFAULT false,
  deleted_at                timestamptz,        -- "archivace" v UI, měkké mazání podle 2.1 části 1
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_lists__workspace_name ON lists (workspace_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_lists__workspace_default ON lists (workspace_id) WHERE is_default AND deleted_at IS NULL;
```

```sql
CREATE TABLE list_subscriptions (
  contact_id            uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  list_id               uuid        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  workspace_id          uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status                text        NOT NULL
    CHECK (status IN ('pending','confirmed','unsubscribed','bounced','complained')),
  source                text        NOT NULL
    CHECK (source IN ('manual','import','api','form','webhook','preference_center','double_opt_in','migration')),
  source_ref            text,
  subscribed_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_at          timestamptz,
  unsubscribed_at       timestamptz,
  unsubscribe_reason    text        CHECK (unsubscribe_reason IN
    ('link','one_click','preference_center','api','manual','complaint','bounce','global','objection','import')),
  unsubscribe_campaign_id uuid,
  snooze_until          timestamptz,
  confirmation_sent_at  timestamptz,
  confirmation_resends  smallint    NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, list_id)
);

-- Sestavení publika kampaně: "všichni potvrzení na seznamu X". Nejčastější dotaz v systému.
CREATE INDEX idx_list_subscriptions__list_status ON list_subscriptions (list_id, status, contact_id);
-- Úklidový job na nepotvrzená přihlášení a job na připomínku potvrzení.
CREATE INDEX idx_list_subscriptions__pending ON list_subscriptions (workspace_id, confirmation_sent_at)
  WHERE status = 'pending';
-- Zrušení pozastavení, jakmile vyprší.
CREATE INDEX idx_list_subscriptions__snooze ON list_subscriptions (workspace_id, snooze_until)
  WHERE snooze_until IS NOT NULL;
```

Primární klíč `(contact_id, list_id)` je zvolený schválně proti `(list_id, contact_id)`: detail kontaktu potřebuje všechny jeho seznamy, což je nejčastější přístup z UI. Opačný směr pokrývá index 1.

```sql
CREATE TABLE subscription_confirmations (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id    uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  list_id       uuid        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  token_hash    bytea       NOT NULL,          -- SHA-256 syrového tokenu, syrový token se neukládá
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  consumed_ip   inet,
  request_ip    inet,
  request_user_agent text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Ověření tokenu je jediný přístup do této tabulky a musí být O(1).
CREATE UNIQUE INDEX uq_subscription_confirmations__token_hash ON subscription_confirmations (token_hash);
-- Úklid prošlých a nespotřebovaných tokenů.
CREATE INDEX idx_subscription_confirmations__expiry ON subscription_confirmations (expires_at) WHERE consumed_at IS NULL;
```

### 3.4 Souhlasy

```sql
CREATE TABLE consents (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id    uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  purpose       text        NOT NULL
    CHECK (purpose IN ('email_marketing','analytics','personalization','profiling','third_party')),
  scope_list_id uuid        REFERENCES lists(id) ON DELETE SET NULL,   -- NULL = celý projekt
  status        text        NOT NULL CHECK (status IN ('granted','withdrawn')),
  legal_basis   text        NOT NULL
    CHECK (legal_basis IN ('consent','legitimate_interest','contract','soft_opt_in')),
  source        text        NOT NULL
    CHECK (source IN ('form','import','api','double_opt_in','admin','webhook',
                      'preference_center','one_click','complaint','objection','migration')),
  source_ref    text,
  consent_text  text,                                  -- doslovné znění, které subjekt odsouhlasil
  consent_text_hash bytea,                             -- SHA-256 znění, kvůli porovnání verzí
  evidence      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recorded_by   text        NOT NULL DEFAULT 'system',
  occurred_at   timestamptz NOT NULL,                  -- kdy se to stalo (import může nést historické datum)
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Historie souhlasů jednoho kontaktu pro účel: výpis v detailu a export dat subjektu.
CREATE INDEX idx_consents__contact_purpose ON consents (contact_id, purpose, occurred_at DESC);
-- Audit "kdo dal souhlas přes formulář F v období X".
CREATE INDEX idx_consents__ws_purpose ON consents (workspace_id, purpose, occurred_at DESC);
```

Tabulka je **append only**. Vynucuje se pravidlem, které povolí jen `INSERT`:

```sql
CREATE RULE consents_no_update AS ON UPDATE TO consents DO INSTEAD NOTHING;
CREATE RULE consents_no_delete AS ON DELETE TO consents DO INSTEAD NOTHING;
```

To ale zablokuje i `ON DELETE CASCADE` z kontaktu. Řešení: pravidla se aplikují na běžnou aplikační roli, zatímco výmaz podle GDPR běží pod rolí `openengage_gdpr`, pro kterou se pravidla obejdou přes `ALTER TABLE consents DISABLE RULE` v jedné transakci. Alternativa, kterou navrhuju jako výchozí, protože je jednodušší a auditovatelná: **pravidla nezavádět a append-only vynutit v repository vrstvě a testem**, který se pokusí o `UPDATE` a musí selhat na chybějícím oprávnění (`REVOKE UPDATE, DELETE ON consents FROM openengage_app`).

Rychlý pohled na aktuální stav souhlasu (segmentace nesmí procházet append-only log):

```sql
CREATE TABLE contact_consent_state (
  contact_id      uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purpose         text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('granted','withdrawn')),
  legal_basis     text        NOT NULL,
  since           timestamptz NOT NULL,
  last_consent_id uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, purpose)
);
-- Segment "má souhlas s analytikou": od účelu ke kontaktům.
CREATE INDEX idx_contact_consent_state__ws_purpose_status ON contact_consent_state (workspace_id, purpose, status, contact_id);
```

Zápis do `consents` a aktualizace `contact_consent_state` probíhá vždy v jedné transakci. Při nesouladu (obnova ze zálohy, migrace) existuje job `consents.rebuild_state`, který stav přepočítá z logu.

### 3.5 Suppression list

```sql
CREATE TABLE suppressions (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         citext      NOT NULL,     -- u reason='gdpr_erasure' placeholder, viz 4.14.4
  email_hash    bytea       NOT NULL,     -- HMAC-SHA256(SUPPRESSION_HASH_KEY, lower(původní e-mail))
  reason        text        NOT NULL CHECK (reason IN
    ('hard_bounce','soft_bounce_threshold','complaint','manual','global_unsubscribe',
     'one_click_unsubscribe','invalid','import','gdpr_erasure','ses_suppressed')),
  source        text        NOT NULL,
  source_ref    text,
  detail        text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- diagnostika bouncu, viz 4.10.4
  removable     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text        NOT NULL DEFAULT 'system',
  removed_at    timestamptz,
  removed_by    uuid,
  removal_note  text
);

-- Kontrola "smí se na tuhle adresu poslat" musí být O(1) a běží při každém přihlášení,
-- importovaném řádku i materializaci publika.
CREATE UNIQUE INDEX uq_suppressions__workspace_email ON suppressions (workspace_id, email)
  WHERE removed_at IS NULL;
-- Druhá větev téže kontroly pro adresy, které byly vymazané podle GDPR a plaintext už nemáme.
CREATE INDEX idx_suppressions__ws_email_hash ON suppressions (workspace_id, email_hash)
  WHERE removed_at IS NULL;
-- Přehled a export suppression listu podle důvodu.
CREATE INDEX idx_suppressions__ws_reason ON suppressions (workspace_id, reason, created_at DESC);
```

Odebrání ze suppression listu je **měkké** (`removed_at`), ne fyzické. Důvod: potřebujeme umět doložit, že adresa byla zablokovaná v době, kdy jsme na ni neposílali, a zároveň zjistit, kdo blokaci sundal.

`metadata` nese diagnostiku, kterou dodá část 4a a která se zobrazuje v UI, aby šlo uživateli vysvětlit, **proč** je adresa zablokovaná. Bez ní se dá říct jen „adresa je blokovaná", což je pro podporu k ničemu.

Dohodnutý tvar, názvy klíčů jsou ty, které posílá část 4a:

```jsonc
{
  "bounceType":        "Permanent",              // SES: Permanent | Transient | Undetermined
  "bounceSubType":     "General",                // SES: General | NoEmail | Suppressed | MailboxFull ...
  "diagnosticCode":    "smtp; 550 5.1.1 User unknown",
  "feedbackId":        "0100018f-...",           // SES feedback id, kvůli dohledání u AWS
  "provider":          "ses",                    // ses | smtp
  "providerMessageId": "0100018f-...",
  "campaignId":        "0192f3a0-...",           // kampaň, při které to nastalo
  "reportingMta":      "dsn; a8-70.smtp-out.amazonses.com",
  "occurredAt":        "2026-07-31T09:12:00.000Z",
  "occurrences":       [ /* při opakovaném podnětu se sem přidává, viz 4.10.4 */ ]
}
```

Klíče jsou `camelCase`, protože jde o neprůhledný JSON předávaný mezi částmi, ne o tělo API. Schéma je volné (`jsonb` bez `CHECK`), aby přidání dalšího pole od providera nevyžadovalo migraci. UI zobrazuje `diagnosticCode` doslova, protože zpráva od cílového serveru je často jediná použitelná informace, a `bounceType` plus `bounceSubType` překládá do češtiny.

`ses_suppressed` je důvod pro `OnAccountSuppressionList` od SES, tedy adresa, kterou zablokoval sám provider na úrovni účtu. Je to vlastní důvod, ne `hard_bounce`, protože se odebírá jinde (v SES konzoli) a naše odebrání by nic nevyřešilo.

### 3.6 Import a export

```sql
CREATE TABLE imports (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename          text        NOT NULL,
  storage_key       text        NOT NULL,
  byte_size         bigint      NOT NULL CHECK (byte_size > 0),
  content_sha256    bytea       NOT NULL,
  idempotency_key   text        NOT NULL,

  status            text        NOT NULL CHECK (status IN
    ('pending','validating','previewing','importing','completed',
     'completed_with_errors','failed','cancelled')),

  encoding          text,                       -- 'utf-8' | 'windows-1250' | 'iso-8859-2' | ...
  encoding_source   text        CHECK (encoding_source IN ('bom','utf8_validation','score','manual')),
  delimiter         text        CHECK (delimiter IN (';', ',', E'\t', '|')),
  quote_char        text        NOT NULL DEFAULT '"',
  has_header        boolean     NOT NULL DEFAULT true,

  mapping           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  options           jsonb       NOT NULL DEFAULT '{}'::jsonb,

  total_rows        bigint,                     -- známé až po prvním průchodu, může být NULL
  checkpoint_row    bigint      NOT NULL DEFAULT 0,
  checkpoint_byte   bigint      NOT NULL DEFAULT 0,
  processed_rows    bigint      NOT NULL DEFAULT 0,
  created_rows      bigint      NOT NULL DEFAULT 0,
  updated_rows      bigint      NOT NULL DEFAULT 0,
  skipped_rows      bigint      NOT NULL DEFAULT 0,
  suppressed_rows   bigint      NOT NULL DEFAULT 0,
  error_rows        bigint      NOT NULL DEFAULT 0,
  warning_rows      bigint      NOT NULL DEFAULT 0,
  review_rows       bigint      NOT NULL DEFAULT 0,   -- kolik jich šlo do fronty ke kontrole vokativu

  error_summary     jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { "email_invalid": 12, ... }
  failure_code      text,
  failure_detail    text,

  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  file_expires_at   timestamptz NOT NULL
);

-- Idempotence: stejný soubor + stejné mapování + stejné volby = tentýž import.
CREATE UNIQUE INDEX uq_imports__workspace_idempotency ON imports (workspace_id, idempotency_key);
CREATE INDEX idx_imports__ws_created ON imports (workspace_id, created_at DESC);
-- Retenční job na smazání souborů z úložiště.
CREATE INDEX idx_imports__file_expiry ON imports (file_expires_at) WHERE storage_key IS NOT NULL;
```

```sql
CREATE TABLE import_errors (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  import_id     uuid        NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  row_number    bigint      NOT NULL,
  severity      text        NOT NULL CHECK (severity IN ('error','warning')),
  column_name   text,
  error_code    text        NOT NULL,
  error_detail  text,
  raw_line      text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Stažení chybných řádků v původním pořadí a stránkování v UI.
CREATE INDEX idx_import_errors__import_row ON import_errors (import_id, row_number);
```

Uloží se maximálně `IMPORT_MAX_STORED_ERRORS` (výchozí 10 000) chybných a 10 000 varovných řádků na import. Nad limit se už jen inkrementují čítače v `error_summary`.

```sql
CREATE TABLE exports (
  id              uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('contacts','suppressions','import_errors','gdpr_subject')),
  filter          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  columns         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  format          text        NOT NULL DEFAULT 'csv' CHECK (format IN ('csv','ndjson')),
  encoding        text        NOT NULL DEFAULT 'utf-8-bom'
                                CHECK (encoding IN ('utf-8-bom','utf-8','windows-1250')),
  delimiter       text        NOT NULL DEFAULT ';',
  status          text        NOT NULL CHECK (status IN ('queued','running','completed','failed','expired')),
  row_count       bigint,
  storage_key     text,
  byte_size       bigint,
  download_token_hash bytea,
  expires_at      timestamptz NOT NULL,
  failure_code    text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX idx_exports__ws_created ON exports (workspace_id, created_at DESC);
CREATE UNIQUE INDEX uq_exports__download_token ON exports (download_token_hash) WHERE download_token_hash IS NOT NULL;
CREATE INDEX idx_exports__expiry ON exports (expires_at) WHERE status = 'completed';
```

### 3.7 Přepisy jmen na úrovni projektu

```sql
CREATE TABLE name_overrides (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('first','last')),
  name_key      text        NOT NULL,       -- lower + NFD + odstraněné diakritické znaky
  gender        text        CHECK (gender IN ('female','male','unknown')),
  vocative      text,
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_name_overrides__has_value CHECK (gender IS NOT NULL OR vocative IS NOT NULL)
);
-- Vyhledání při každém zápisu kontaktu, musí být O(1). Tabulka je malá (stovky až tisíce řádků).
CREATE UNIQUE INDEX uq_name_overrides__ws_kind_key ON name_overrides (workspace_id, kind, name_key);
```

Tohle je jediný mechanismus, kterým se fronta ke kontrole vokativu časem vyprázdní místo toho, aby při každém importu narostla znovu.

### 3.8 Segmenty

```sql
CREATE TABLE segments (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description       text,
  kind              text        NOT NULL DEFAULT 'dynamic' CHECK (kind IN ('dynamic','static')),
  preset_key        text,                       -- neprázdné u segmentů založených z presetu, viz 4.12
  definition        jsonb       NOT NULL,
  definition_hash   bytea       NOT NULL,       -- SHA-256 kanonického JSON, kvůli detekci změny
  ast_version       smallint    NOT NULL DEFAULT 1,

  cached_count      bigint,
  cached_is_exact   boolean,
  cached_at         timestamptz,
  cached_duration_ms int,
  recompute_state   text        NOT NULL DEFAULT 'idle'
                                  CHECK (recompute_state IN ('idle','queued','running','error')),
  last_error_code   text,

  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz         -- "archivace" v UI, měkké mazání podle 2.1 části 1
);
CREATE UNIQUE INDEX uq_segments__workspace_name ON segments (workspace_id, lower(name)) WHERE deleted_at IS NULL;
-- Plánovač přepočtu bere segmenty s nejstarším cached_at. NULLS FIRST kvůli nově vytvořeným.
CREATE INDEX idx_segments__stale ON segments (cached_at NULLS FIRST)
  WHERE deleted_at IS NULL AND kind = 'dynamic';

CREATE TABLE segment_members (
  segment_id    uuid        NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  contact_id    uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, contact_id)
);
-- "Ve kterých statických segmentech je tenhle kontakt", zobrazuje se v detailu kontaktu.
CREATE INDEX idx_segment_members__contact ON segment_members (contact_id);
```

### 3.9 Formuláře

```sql
CREATE TABLE forms (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  slug              text        NOT NULL CHECK (slug ~ '^[a-z0-9]{16,32}$'),  -- neuhodnutelné
  fields            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  design            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  custom_css        text        CHECK (char_length(custom_css) <= 20000),
  list_ids          uuid[]      NOT NULL DEFAULT '{}',
  tag_ids           uuid[]      NOT NULL DEFAULT '{}',
  double_opt_in     boolean     NOT NULL DEFAULT true,
  consent_text      text,
  consent_required  boolean     NOT NULL DEFAULT true,
  legal_basis       text        NOT NULL DEFAULT 'consent',
  honeypot_field    text        NOT NULL DEFAULT 'website',
  min_fill_seconds  smallint    NOT NULL DEFAULT 2 CHECK (min_fill_seconds BETWEEN 0 AND 60),
  allowed_origins   text[]      NOT NULL DEFAULT '{}',   -- prázdné = jakýkoliv původ (s varováním v UI)
  captcha_provider  text        CHECK (captcha_provider IN ('none','turnstile','hcaptcha')),
  captcha_config    jsonb,
  redirect_url      text,
  success_message   jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { "cs": "...", "en": "..." }
  active            boolean     NOT NULL DEFAULT true,
  submission_count  bigint      NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Veřejný endpoint /f/{slug} hledá jen podle slugu, bez znalosti projektu.
CREATE UNIQUE INDEX uq_forms__slug ON forms (slug);
CREATE INDEX idx_forms__ws_created ON forms (workspace_id, created_at DESC);

CREATE TABLE form_submissions (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  form_id       uuid        NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id    uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  status        text        NOT NULL CHECK (status IN ('accepted','rejected','dropped')),
  error_code    text,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  page_url      text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_form_submissions__form_created ON form_submissions (form_id, created_at DESC);
-- Retenční job maže po `form_submissions` dnech, chodí přes celý projekt.
CREATE INDEX idx_form_submissions__ws_created ON form_submissions (workspace_id, created_at);
```

### 3.10 Příchozí webhooky

```sql
CREATE TABLE inbound_endpoints (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  slug              text        NOT NULL CHECK (slug ~ '^[a-z0-9]{24,40}$'),
  signature_mode    text        NOT NULL DEFAULT 'hmac_sha256'
    CHECK (signature_mode IN ('none','hmac_sha256','shared_secret','basic')),
  signature_config  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  secret_encrypted  bytea,
  ip_allowlist      inet[]      NOT NULL DEFAULT '{}',
  mapping           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  mapping_version   int         NOT NULL DEFAULT 1,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_inbound_endpoints__slug ON inbound_endpoints (slug);

CREATE TABLE inbound_deliveries (
  id            uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL,
  endpoint_id   uuid        NOT NULL,
  external_id   text,
  status        text        NOT NULL CHECK (status IN
    ('received','processed','ignored','unmapped','rejected','failed')),
  error_code    text,
  error_detail  text,
  contact_id    uuid,
  action        text,                       -- subscribe | unsubscribe | update | ignore
  payload       jsonb       NOT NULL,
  headers       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),   -- partitioning key, konvence 2.1 části 1
  processed_at  timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Deduplikace opakovaného doručení téže události. Částečný index, protože external_id je volitelné.
CREATE UNIQUE INDEX uq_inbound_deliveries__dedup
  ON inbound_deliveries (endpoint_id, external_id, created_at) WHERE external_id IS NOT NULL;
CREATE INDEX idx_inbound_deliveries__endpoint_created ON inbound_deliveries (endpoint_id, created_at DESC);
```

Partitioning po měsících podle konvence 2.1 části 1: `PARTITION BY RANGE (created_at)`, `PRIMARY KEY (id, created_at)`, bez `DEFAULT` partition. Zakládání obstarává job `platform.maintain_partitions` části 1, takže `inbound_deliveries` je potřeba doplnit do jeho seznamu (požadavek 1.14). Retence 30 dní znamená, že se drží dvě až tři partition a staré se odpojují a dropují, ne mažou po řádcích.

Deduplikace přes `(endpoint_id, external_id, created_at)` funguje jen uvnitř jedné partition. Pro dedup přes hranici měsíce se navíc drží malá nepartitionovaná tabulka klíčů:

```sql
CREATE TABLE inbound_dedup (
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint_id   uuid        NOT NULL REFERENCES inbound_endpoints(id) ON DELETE CASCADE,
  external_id   text        NOT NULL,
  delivery_id   uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint_id, external_id)
);
CREATE INDEX idx_inbound_dedup__created ON inbound_dedup (created_at);
```

### 3.11 GDPR a retence

```sql
CREATE TABLE gdpr_requests (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id        uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  subject_email_hash bytea      NOT NULL,      -- plaintext se v této tabulce nikdy neukládá
  type              text        NOT NULL CHECK (type IN
    ('access','portability','erasure','rectification','restriction','objection')),
  mode              text        CHECK (mode IN ('anonymize','purge')),   -- jen u type='erasure'
  status            text        NOT NULL CHECK (status IN
    ('received','verifying','processing','completed','rejected','failed')),
  channel           text        NOT NULL CHECK (channel IN ('preference_center','admin','api')),
  requested_at      timestamptz NOT NULL,
  due_at            timestamptz NOT NULL,      -- requested_at + 1 měsíc, čl. 12 odst. 3
  extended_until    timestamptz,               -- max +2 měsíce
  extension_reason  text,
  verified_at       timestamptz,
  completed_at      timestamptz,
  export_id         uuid        REFERENCES exports(id) ON DELETE SET NULL,
  affected          jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- počty řádků po tabulkách
  rejection_reason  text,
  requested_by      text,
  processed_by      uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- Panel "co je po termínu" je hlavní pohled v této tabulce.
CREATE INDEX idx_gdpr_requests__ws_due ON gdpr_requests (workspace_id, due_at)
  WHERE status IN ('received','verifying','processing');
CREATE INDEX idx_gdpr_requests__ws_created ON gdpr_requests (workspace_id, created_at DESC);
CREATE INDEX idx_gdpr_requests__ws_email_hash ON gdpr_requests (workspace_id, subject_email_hash);
```

```sql
CREATE TABLE retention_policies (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target        text        NOT NULL CHECK (target IN
    ('import_files','import_errors','form_submissions','inbound_deliveries',
     'unconfirmed_subscriptions','inactive_contacts','exports')),
  retain_days   int         NOT NULL CHECK (retain_days BETWEEN 1 AND 3650),
  action        text        NOT NULL CHECK (action IN ('delete','anonymize')),
  enabled       boolean     NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_retention_policies__workspace_target ON retention_policies (workspace_id, target);

CREATE TABLE retention_runs (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  policy_id     uuid        REFERENCES retention_policies(id) ON DELETE SET NULL,
  target        text        NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  scanned       bigint      NOT NULL DEFAULT 0,
  affected      bigint      NOT NULL DEFAULT 0,
  status        text        NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  error_detail  text
);
CREATE INDEX idx_retention_runs__ws_started ON retention_runs (workspace_id, started_at DESC);
```

### 3.12 Nastavení projektu vlastněná touto částí

Ukládají se do `workspaces.settings jsonb` pod klíčem `contacts`:

Zod schéma se exportuje z `packages/core/contacts` a slučuje se do `WorkspaceSettingsSchema` části 1 (její konvence 2.4). Klíče jsou `snake_case`, protože nastavení jde ven přes API.

```ts
// workspaces.settings.contacts
export const ContactsWorkspaceSettingsSchema = z.object({
  salutation_by:        z.enum(['first_name', 'surname']).default('first_name'),
  vocative_policy:      z.enum(['strict', 'balanced']).default('balanced'),
  default_country:      z.string().length(2).nullable().default('CZ'),  // normalizace telefonů
  number_format:        z.enum(['auto', 'cs', 'en']).default('auto'),
  date_format:          z.enum(['auto', 'cs', 'en']).default('cs'),
  export_encoding:      z.enum(['utf-8-bom', 'utf-8', 'windows-1250']).default('utf-8-bom'),
  export_delimiter:     z.enum([';', ',']).default(';'),
  contact_limit:        z.number().int().positive().nullable().default(null),
  require_consent_on_import: z.boolean().default(true),
}).strict();
```

**Vykání a tykání tady není.** Čte se ze sloupce `workspaces.address_form` (`formal` \| `informal`), který vlastní část 1. Výsledný tvar oslovení je kombinace obou:

| `workspaces.address_form` | `settings.contacts.salutation_by` | Tvar oslovení |
|---|---|---|
| `formal` | `first_name` | `Dobrý den, Jano` |
| `informal` | `first_name` | `Ahoj Jano` |
| `formal` | `surname` | `Vážená paní Nováková,` |
| `informal` | `surname` | nedává smysl, spadne na `informal` + `first_name` |

Výchozí jazyk kontaktu se **nekonfiguruje zde**, bere se z `workspaces.locale` (viz 2.5).

---

## 4. Doménová logika

### 4.1 Kontakty a upsert politika

#### 4.1.1 Normalizace e-mailu

Jediný klíč kontaktu je e-mail. Normalizace probíhá stejně ve všech kanálech, jinak by tentýž člověk vznikl dvakrát:

1. Unicode NFC.
2. Odstranění bílých znaků na začátku a konci, včetně NBSP (U+00A0) a dalších mezer z kategorie Zs.
3. Odstranění obalujících lomených závorek: `<jan@x.cz>` → `jan@x.cz`.
4. Rozbalení tvaru s display jménem: `Jan Novák <jan@x.cz>` → adresa `jan@x.cz`, a pokud není namapované jméno, použije se `Jan Novák` jako `full_name` (jen při importu, ne přes API).
5. Převod na malá písmena (celý řetězec, včetně lokální části). Lokální část je formálně case-sensitive, ale v praxi ji rozlišuje mizivé procento serverů a nerozlišování je jediné, co brání duplicitám. Je to vědomé rozhodnutí a je zapsané v dokumentaci.
6. Odmítnutí, pokud délka není 3 až 254 znaků, chybí právě jedno `@`, doména neobsahuje tečku, doména začíná nebo končí pomlčkou nebo tečkou, nebo řetězec obsahuje bílý znak či řídicí znak.
7. IDN doména se převede na punycode (`jan@háčkyčárky.cz` → `jan@xn--hkyrky-ptac70bc.cz`). Lokální část se nechává v UTF-8; SMTPUTF8 řeší část 4.

Validace je **syntaktická**. Nedělá se DNS ani MX dotaz, protože by to import 5 milionů řádků prodloužilo o hodiny a stejně nezaručí doručitelnost. Volitelně lze zapnout kontrolu proti seznamu jednorázových domén (`DISPOSABLE_DOMAINS_FILE`), který se načte do paměti při startu.

#### 4.1.2 Upsert napříč třemi kanály

Konfliktem se rozumí zápis kontaktu s e-mailem, který v projektu už existuje.

| Kanál | Výchozí režim | Lze změnit | Poznámka |
|---|---|---|---|
| `POST /api/v1/contacts` | `update` | ano, pole `on_conflict` | `create` navíc znamená „selži při konfliktu 409" |
| CSV import | `update` | ano, `options.on_conflict` | volby `skip`, `update`, `overwrite` |
| Veřejný formulář | `update` | **ne** | formulář nikdy nesmí mazat data |
| Příchozí webhook | `update` | ano, `mapping.on_conflict` | |
| Preference center | `update` | ne | jen pole s `subject_editable = true` |

Sémantika režimů:

| Režim | Existující kontakt | Prázdná hodnota ve vstupu | Nenamapované pole |
|---|---|---|---|
| `skip` | nezmění se | ignoruje se | nezmění se |
| `update` | přepíší se jen neprázdné hodnoty | ponechá se stará hodnota | nezmění se |
| `overwrite` | přepíší se všechny namapované hodnoty | **vymaže starou hodnotu** | nezmění se |
| `create` | `409 already_exists` | neaplikuje se | neaplikuje se |

Pravidla, která platí ve **všech** režimech a nejdou vypnout:

1. **`email` se nikdy nemění.** Je to klíč. Změna adresy je operace `POST /api/v1/contacts/{id}/change-email`, která má vlastní kontrolu proti kolizi a vlastní záznam v auditu.
2. **`attributes` se slučují po klíčích**, nikdy se nenahrazují celé. Import s pěti namapovanými poli nesmí smazat sedm polí, která do souboru nepatřila. Vymazání jednoho vlastního pole se v režimu `overwrite` provede nastavením `null`, což klíč z JSONB odstraní.
3. **`status` se nikdy nepovyšuje importem, API zápisem, formulářem ani webhookem.** Přechody `unsubscribed → active`, `complained → active` a `bounced → active` jsou možné jen dvěma cestami: potvrzením double opt-in konkrétním člověkem, nebo ručním zásahem správce se záznamem v auditu. Bez tohohle pravidla by stačilo znovu naimportovat starý soubor a všichni odhlášení by byli zpátky. Je to nejdůležitější pravidlo celé kapitoly.
4. **Kontakt na suppression listu s důvodem `complaint` nebo `gdpr_erasure` se nezapisuje vůbec.** Řádek se počítá jako `suppressed_rows` a končí. U ostatních důvodů suppression se kontakt zapíše, ale nevznikne žádné přihlášení do seznamu a žádný souhlas.
5. **`skip` se týká jen polí kontaktu.** Přihlášení do seznamů, štítky a záznam souhlasu se aplikují i v režimu `skip`, protože „přidej tyhle lidi do seznamu, ale nesahej mi na jejich data" je běžný a legitimní požadavek. Kdyby `skip` blokoval i to, uživatel by neměl jak přidat existující kontakty do seznamu importem.
6. **Zamknutý vokativ** (`vocative_locked = true`) přežije zápis jména, pokud se jméno nezměnilo. Když se změnilo, zámek padá, viz 4.4.8.

#### 4.1.3 Tvar upsert dotazu

```sql
INSERT INTO contacts (id, workspace_id, email, email_hash, first_name, last_name, gender,
                      gender_source, first_name_vocative, last_name_vocative,
                      vocative_confidence, greeting, attributes, locale, source, source_ref,
                      created_at, updated_at)
SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::citext[], ...)
ON CONFLICT (workspace_id, email) WHERE deleted_at IS NULL DO UPDATE SET
  first_name  = CASE WHEN $mode = 'overwrite' THEN excluded.first_name
                     ELSE coalesce(nullif(excluded.first_name, ''), contacts.first_name) END,
  ...
  attributes  = contacts.attributes || excluded.attributes,
  updated_at  = now()
WHERE contacts.deleted_at IS NULL
RETURNING id, (xmax = 0) AS inserted;
```

`xmax = 0` v `RETURNING` rozliší vložení od aktualizace, což je potřeba pro čítače `created_rows` a `updated_rows` a pro rozhodnutí, jestli poslat událost `contact.created` nebo `contact.updated`. Dávka je pole hodnot přes `unnest`, ne 1 000 samostatných `INSERT`.

Klauzule `WHERE deleted_at IS NULL` za `ON CONFLICT` je **inference částečného indexu**, ne filtr: PostgreSQL podle ní pozná, že arbitrem konfliktu je `uq_contacts__workspace_email`, který je částečný. Bez ní by příkaz skončil chybou 42P10 „no unique or exclusion constraint matching the ON CONFLICT specification". Je to nenápadná past, která stojí půl hodiny ladění, proto je tady napsaná.

Duplicitní `WHERE contacts.deleted_at IS NULL` v `DO UPDATE` část je tam schválně jako pojistka pro případ, že by se index někdy změnil zpět na úplný.

#### 4.1.4 Souběh

Dva paralelní importy do stejného projektu se stejným e-mailem: `ON CONFLICT` serializuje zápis na úrovni řádku, poslední vyhrává. Riziko ztraceného zápisu je přijatelné, protože obě hodnoty pocházejí z importu uživatele. Do `imports.options` se ale zapisuje varování, když se v projektu při běhu importu spustí druhý.

Limit: **jeden běžící import na projekt.** Druhý se zařadí do fronty se stavem `pending` a v UI se zobrazí „ve frontě, spustí se po dokončení importu X". Vynucuje se pg-boss `singletonKey = workspace_id` na jobu `contacts.import`.

#### 4.1.5 Mazání kontaktu

| Operace | Efekt | Kdo smí |
|---|---|---|
| `DELETE /api/v1/contacts/{id}` (výchozí) | `deleted_at = now()`, `status = 'deleted'`, e-mail zůstává | editor |
| `?mode=anonymize` | plná anonymizace podle 4.14.4 | admin |
| `?mode=purge` | fyzické smazání řádku a kaskád | owner |
| Hromadné mazání segmentu | job `contacts.bulk_delete`, dávky 5 000 | owner |

Měkce smazaný kontakt zmizí ze všech seznamů, segmentů a publik, ale jde ho do 30 dnů obnovit (`POST /api/v1/contacts/{id}/restore`). Po 30 dnech ho retenční job anonymizuje.

#### 4.1.6 Kdo smí dostat kampaň (normativní)

Tahle podkapitola existuje proto, že „smí se na tenhle kontakt poslat" si dnes každá část vykládá po svém. Následující je závazné a nikde jinde se to nesmí definovat znovu.

**Hodnoty `contacts.status` a jejich význam:**

| Hodnota | Význam | Smí dostat kampaň |
|---|---|---|
| `active` | Kontakt je v pořádku a je mailovatelný | **ano, jako jediný** |
| `unconfirmed` | Vznikl, ale nemá jediné potvrzené přihlášení | ne |
| `unsubscribed` | Globálně se odhlásil nebo vznesl námitku podle čl. 21 | ne |
| `bounced` | Adresa trvale neexistuje | ne |
| `complained` | Označil naši poštu jako spam | ne, nikdy |
| `deleted` | Měkce smazaný nebo anonymizovaný | ne |

Hodnota **`subscribed` neexistuje** a nikdy neexistovala. Kdo ji v dotazu použije, dostane nula řádků a kampaň neodejde nikomu.

**Autoritativní brána je vrstvená a `contacts.status` v ní není první.** Pořadí, ve kterém se rozhoduje:

1. **`suppressions`** (workspace-wide zákaz odesílání). Autoritativní, viz 4.10.3. Kontroluje se vždy, i kdyby `status` byl `active`.
2. **`contacts.deleted_at IS NULL` a `processing_restricted = false`.** Tvrdé vyloučení, žádná výjimka.
3. **`list_subscriptions.status = 'confirmed'`** pro kampaň mířenou na seznam, plus `snooze_until` v minulosti nebo NULL. **Tohle je skutečná brána pro kampaň na seznam**, ne `contacts.status`. Kontakt s `contacts.status = 'active'`, který má na daném seznamu `pending`, poštu nedostane.
4. **`contacts.status = 'active'`** pro kampaň mířenou na segment bez seznamu, kde bod 3 neplatí.

`contacts.status` je tedy **odvozený souhrnný údaj pro zobrazení a levné filtrování**, ne bezpečnostní brána. Udržuje se v téže transakci jako změna, která ho způsobila (viz 4.10.4). Kdo staví publikum, nesmí se na něj spoléhat sám o sobě; má volat `compileAudienceToSql` z 4.11.3, která všechny čtyři vrstvy aplikuje za něj.

#### 4.1.7 Důsledky částečného unikátního indexu

Konvence 2.1 části 1 vyžaduje u měkce mazaných tabulek částečný unikátní index (`WHERE deleted_at IS NULL`). Pro kontakty to má tři důsledky, které musí být ošetřené, jinak vznikne tichá nekonzistence:

| Situace | Chování | Proč tak |
|---|---|---|
| Kontakt je měkce smazaný, přijde import nebo přihlášení téže adresy | Vznikne **nový** řádek s novým `id`. Starý zůstane smazaný. | Je to správné chování: člověk se znovu přihlásil. Jeho stará historie je oddělená a to je v pořádku, protože smazání byl vědomý akt. |
| `POST /contacts/{id}/restore` a mezitím vznikl živý kontakt se stejnou adresou | `409 already_exists` s `errors[0].code = "email_taken_by_live_contact"`, v odpovědi je `id` živého kontaktu a nabídka „sloučit". | Bez téhle kontroly by obnova vyrobila dva živé řádky se stejnou adresou a unikátní index by to nezachytil, protože byl v okamžiku obnovy splněný. **Kontrola je povinná a má vlastní test.** |
| Anonymizovaný kontakt (`deleted_at` i `anonymized_at`) | Má placeholder e-mail `erased+{id}@erased.invalid`, takže do indexu stejně nikdy nezasahuje. Znovunaimportování původní adresy blokuje **suppression list**, ne unikátní index. | Ochrana proti vzkříšení je záměrně na jiné vrstvě než unikátnost, viz 4.14.4. |

Obnova probíhá pod `SELECT ... FOR UPDATE` nad případným živým řádkem se stejnou adresou, takže dvě souběžné obnovy nemohou závod vyhrát obě.

### 4.2 Vlastní pole

#### 4.2.1 Kde se ukládají a proč

Všechna vlastní pole jsou v `contacts.attributes jsonb`. Alternativa (skutečný sloupec na pole) byla zamítnutá ze tří důvodů: `ALTER TABLE ADD COLUMN` s výchozí hodnotou na tabulce s 5 miliony řádků drží `ACCESS EXCLUSIVE` zámek, schéma by se lišilo projekt od projektu a přestalo by být verzovatelné, a limit sloupců v PostgreSQL (1 600) je pro víceprojektovou instalaci reálný strop.

Cena je pomalejší filtrování. Kompenzuje ji dvojí indexace, viz 4.2.6.

Limity: **100 vlastních polí na projekt**, **8 označených jako `indexed`**, klíč max 40 znaků, `text` max 1 000 znaků, `long_text` max 10 000 znaků, celý objekt `attributes` max 64 kB na kontakt (`CHECK (pg_column_size(attributes) <= 65536)`).

Rezervované klíče, které nelze použít pro vlastní pole: `email`, `first_name`, `last_name`, `middle_name`, `title_prefix`, `title_suffix`, `gender`, `greeting`, `locale`, `status`, `id`, `created_at`, `updated_at`, `tags`, `lists`, `unsubscribe_url`, `webview_url`, `first_name_vocative`, `last_name_vocative`.

#### 4.2.2 Typy a jejich `options`

| Typ | Kanonická reprezentace v JSONB | `options` | Validace |
|---|---|---|---|
| `text` | string | `{ max_length?: number, pattern?: string }` | délka ≤ 1000, `pattern` je RE2-kompatibilní podmnožina bez zpětných referencí |
| `long_text` | string | `{ max_length?: number }` | délka ≤ 10000 |
| `number` | JSON number | `{ min?, max?, decimals?: 0..6 }` | konečné číslo, ne NaN, rozsah |
| `boolean` | JSON boolean | `{}` | |
| `date` | string `YYYY-MM-DD` | `{ min?, max? }` | platné datum, roky 1900 až 2200 |
| `datetime` | string RFC 3339 v UTC | `{ min?, max? }` | |
| `enum` | string | `{ values: string[] }` (max 200 hodnot) | hodnota musí být ve `values` |
| `multi_enum` | pole stringů | `{ values: string[], max_items?: number }` | max 50 položek |
| `url` | string | `{ schemes?: ['http','https'] }` | absolutní URL, max 2 000 znaků |
| `email` | string | `{}` | stejná syntaktická validace jako hlavní e-mail |
| `phone` | string, E.164 pokud šlo normalizovat | `{ default_country?: string }` | |

Změna typu existujícího pole je **zakázaná** (`field_type_immutable`). Uživatel musí založit nové pole a staré archivovat. Důvod: tichá konverze 5 milionů hodnot je operace, která nemá bezpečnou cestu zpět, a šablony a segmenty na typ spoléhají.

Archivace a smazání pole mají vlastní podkapitolu 4.2.5, protože obojí zasahuje do cizích částí.

#### 4.2.3 `getFieldCatalog`: co konzumuje část 3

Validátor merge tagů a nabídka polí v editoru šablon (část 3) potřebují jeden zdroj pravdy o tom, jaká pole v projektu existují. REST endpoint na to nestačí, protože kompilace šablony běží uvnitř procesu.

```ts
// packages/core/contacts/fields.ts
export function getFieldCatalog(ctx: WorkspaceContext): Promise<FieldCatalog>;

export type FieldCatalog = {
  fields: FieldCatalogEntry[];
  version: string;          // hash katalogu, kvůli invalidaci cache v části 3
};

export type FieldCatalogEntry = {
  path: string;             // 'first_name' | 'attr.city' | 'greeting'
  type: FieldCatalogType;
  label: { cs: string; en: string };
  group: 'identity' | 'name' | 'salutation' | 'custom' | 'meta';
  itemType?: FieldCatalogType;   // jen u 'list', typ položky
  deleted: boolean;              // true u archivovaného pole; šablona ho smí mít, ale UI ho nenabízí
};

export type FieldCatalogType =
  | 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'list';
```

Mapování typů z `contact_fields.type` na `FieldCatalogType`, aby část 3 nemusela znát naši typovou soustavu:

| `contact_fields.type` | `FieldCatalogType` | `itemType` |
|---|---|---|
| `text`, `long_text`, `url`, `email`, `phone`, `enum` | `string` | |
| `number` | `number` | |
| `boolean` | `boolean` | |
| `date` | `date` | |
| `datetime` | `datetime` | |
| `multi_enum` | `list` | `string` |

Katalog obsahuje **i prvotřídní pole** ze seznamu `CONTACT_MERGE_FIELDS` (viz 2.4), ne jen vlastní. Bez toho by část 3 musela mít druhý, ručně udržovaný seznam, který by se rozešel.

`label` je lokalizovaný, proto je i sloupec `contact_fields.label` typu `jsonb` a ne `text`. U prvotřídních polí se popisky berou z katalogu i18n (`contacts.field.firstName` a podobně), u vlastních polí z databáze; když v `label` chybí jazyk uživatele, použije se `en`, a když chybí i ten, `key`.

`deleted: true` znamená archivované pole. Šablona, která na něj odkazuje, se **nerozbije**, jen validátor vydá varování a editor pole nenabízí. Skutečné smazání pole je jiná operace, viz 4.2.5.

#### 4.2.4 Koerce vstupních hodnot

Platí pro import, API i formuláře. Vstup je vždy nejdřív ořezaný o bílé znaky (pokud `trim_whitespace`), pak koercovaný podle typu pole.

**Čísla.** Nastavení `number_format`:
- `cs`: mezera, NBSP a apostrof jsou oddělovače tisíců, čárka je desetinná.
- `en`: čárka je oddělovač tisíců, tečka je desetinná.
- `auto` (výchozí): odstraní se mezery, NBSP a apostrofy. Pokud řetězec obsahuje čárku i tečku, ten **pravější** z nich je desetinný oddělovač a druhý se odstraní. Pokud obsahuje jen jeden z nich, je to desetinný oddělovač.

Testovací vektory pro `auto`:

| Vstup | Výsledek | Pozn. |
|---|---|---|
| `1 234,56` | `1234.56` | český Excel |
| `1 234.56` | `1234.56` | |
| `1,234.56` | `1234.56` | anglický formát |
| `1234,56` | `1234.56` | |
| `1234.56` | `1234.56` | |
| `1,234` | `1.234` | **past**, v anglickém formátu by to bylo 1234. Náhled importu tuhle hodnotu zvýrazní a vydá varování `number_format_ambiguous` |
| `-1 234,5` | `-1234.5` | |
| `1 234 Kč` | chyba `invalid_number` | jednotky se neodstraňují |
| `` (prázdné) | `null` | při `empty_means_null` |

**Booleany.** Pravda: `1`, `true`, `ano`, `yes`, `y`, `a`, `x`, `on`, `✓`. Nepravda: `0`, `false`, `ne`, `no`, `n`, `off`, prázdno. Porovnání bez ohledu na velikost písmen a diakritiku. Cokoliv jiného je `invalid_boolean`.

**Data.** Nastavení `date_format`:
- `cs` (výchozí pro český projekt): `D.M.YYYY`, `DD.MM.YYYY`, `D. M. YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`.
- `en`: `MM/DD/YYYY`, `YYYY-MM-DD`, `Month D, YYYY`.
- `auto`: zkusí `YYYY-MM-DD`, pak formát podle jazyka projektu.

Celé číslo v rozsahu 20 000 až 60 000 v poli typu `date` je pravděpodobně **sériové číslo z Excelu**. Převede se z epochy 1899-12-30 (tedy včetně známé chyby s přestupným rokem 1900) a řádek dostane varování `excel_serial_date_assumed`. Hodnota se ukáže v náhledu, takže si uživatel může všimnout, že „44927" je 2023-01-01.

`datetime` bez časové zóny se interpretuje v časové zóně projektu.

#### 4.2.5 Archivace a smazání pole

Dvě různé operace s velmi různým dopadem.

**Archivace** (`archived_at`) je měkká a bezpečná. Pole zmizí z UI a z nabídky merge tagů, ale hodnoty v `attributes` zůstanou, segmenty dál fungují a šablony se nerozbijí. V katalogu z 4.2.3 se objeví jako `deleted: true`. Je to výchozí doporučená cesta a UI ji nabízí jako první.

**Smazání** (`DELETE /api/v1/contact-fields/{id}`) je nevratné a dotýká se tří cizích území, takže má povinný dvoufázový průběh.

**Fáze 1: kontrola dopadu.** `GET /api/v1/contact-fields/{id}/impact` vrátí, co všechno se rozbije:

```ts
type FieldImpact = {
  contacts_with_value: number;                  // kolik kontaktů má klíč vyplněný
  segments: { id: string; name: string }[];     // segmenty odkazující na pole
  templates: { id: string; name: string; usages: number }[];   // z části 3
  campaigns_scheduled: { id: string; name: string }[];         // z části 4, naplánované kampaně
  forms: { id: string; name: string }[];        // formuláře zapisující do pole
};
```

Zdroje: segmenty a formuláře si dohledá tato část, šablony přes `findTemplatesUsingField(ctx, path)` z části 3, naplánované kampaně přes část 4. UI zobrazí dialog „Pole *Město* používá 4 šablony a 2 segmenty a má hodnotu u 8 210 kontaktů. Smazáním se hodnoty ztratí a šablony přestanou fungovat." s výčtem a odkazy.

**Fáze 2: smazání.** V jedné transakci se pole smaže z `contact_fields` a pak se zařadí tři joby:

| Job | Vlastník | Co dělá |
|---|---|---|
| `contacts.strip_attribute` | část 2 | odstraní klíč z `attributes` po dávkách 10 000 |
| `content.revalidate_templates` | část 3 | přehodnotí šablony odkazující na pole a označí je jako neplatné |
| `segments.mark_invalid` | část 2 | dotčené segmenty dostanou `recompute_state = 'error'` a `last_error_code = 'segment_field_missing'` |

Řešit segmenty a **neřešit šablony** by byla polovičatá práce: uživatel by zjistil, že mu chybí pole v e-mailu, teprve když by mu odešla kampaň s prázdným místem uprostřed věty. Proto je `content.revalidate_templates` povinná součást, ne volitelný doplněk.

**Smazání pole, které používá naplánovaná kampaň, je zakázané** (`409 conflict` s `field_used_by_scheduled_campaign`). Kampaň se buď zruší, nebo se počká na její odeslání. Kompilovaná šablona kampaně je sice snapshot, ale `render_data` se plní až při materializaci a po smazání pole by tam byla prázdná hodnota.

#### 4.2.6 Indexace pro segmentaci

Dvě úrovně:

1. **GIN `jsonb_path_ops` nad celým `attributes`** (index 6 v 3.1). Pokrývá operátor `@>`, tedy rovnost na string, number, boolean i enum. Kompilátor segmentů proto rovnostní podmínky vždy emituje jako containment: `c.attributes @> jsonb_build_object($k, $v)`.
2. **Částečný výrazový index na konkrétní pole**, když je pole označené `indexed = true`. Pokrývá rozsahové operátory (`>`, `<`, `between`), řazení a `LIKE 'prefix%'`. Zakládá se přes `CREATE INDEX CONCURRENTLY` v jobu `contact_fields.build_index`, stav se propisuje do `index_state`. Při 5 milionech kontaktů to trvá jednotky minut a nezablokuje zápis.

Limit 8 indexovaných polí na projekt existuje proto, že každý další index zdražuje zápis při importu. Uživateli se v UI ukazuje odhad: „index zpomalí import zhruba o 4 procenta a zabere 180 MB".

Vlastní pole, které není `indexed`, se v segmentu použít **smí**. Kompilátor jen do odpovědi náhledu přidá `warnings: ['segment_unindexed_field']` a UI zobrazí „tento dotaz projde všechny kontakty, u velkých projektů může trvat déle".

### 4.3 Štítky

Ploché, bez hierarchie. Jméno je unikátní bez ohledu na velikost písmen. Limit 500 štítků na projekt, 50 štítků na kontakt.

Operace: `POST /api/v1/contacts/{id}/tags` (přidání), `DELETE .../tags/{tag_id}`, hromadné `POST /api/v1/contacts/tags:bulk` s tělem `{ filter: SegmentAst | { ids: string[] }, add: string[], remove: string[] }`. Hromadná operace nad více než 10 000 kontakty běží jako job `contacts.bulk_tag` s dávkami 5 000 a progress barem.

Přejmenování štítku je čistá operace nad `tags.name`, nic se nekopíruje. Sloučení dvou štítků (`POST /api/v1/tags/{id}/merge`) přepíše `contact_tags.tag_id` a zdrojový štítek smaže, v jedné transakci s `ON CONFLICT DO NOTHING` kvůli kontaktům, které mají oba.

### 4.4 Jména, rod a český vokativ

Celá tato podkapitola popisuje jeden modul, `packages/core/contacts/naming`. Je čistý, bez přístupu do databáze kromě čtení `name_overrides`, a je plně otestovatelný tabulkou vstupů a výstupů.

```ts
type NameInput = {
  fullName?: string;          // jeden sloupec se jménem
  firstName?: string;
  lastName?: string;
  titlePrefix?: string;
  titleSuffix?: string;
  gender?: 'female' | 'male' | 'unknown';   // explicitní hodnota ze zdroje
  nameOrder?: 'auto' | 'first_last' | 'last_first';
  locale: string;             // 'cs' | 'sk' | 'en' | ...
};

type NameResult = {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  titlePrefix: string | null;
  titleSuffix: string | null;
  gender: 'female' | 'male' | 'unknown';
  genderSource: GenderSource;
  firstNameVocative: string | null;
  lastNameVocative: string | null;
  vocativeConfidence: 'high' | 'low' | 'none';
  nameSplitConfidence: 'high' | 'low' | 'none';
  greeting: string;
  warnings: NameWarning[];    // NAME_SPLIT_LOW_CONFIDENCE | GENDER_UNKNOWN | VOCATIVE_LOW_CONFIDENCE
                              // | GENDER_CONFLICT | NON_LATIN_SCRIPT | VIETNAMESE_ORDER_ASSUMED
};

function resolveName(input: NameInput, ctx: {
  overrides: NameOverrideLookup;
  settings: ContactsWorkspaceSettings;
}): NameResult;
```

#### 4.4.1 Normalizace vstupu

1. Unicode NFC.
2. Všechny mezery z kategorie Zs (včetně NBSP U+00A0 a úzké NBSP U+202F) na U+0020, sbalení opakovaných mezer, ořez z obou stran.
3. Odstranění řídicích znaků.
4. Když po normalizaci zbyde prázdný řetězec, hodnota je `null`.
5. Délka nad 100 znaků: hodnota se zkrátí a přidá se varování `value_truncated`.
6. Detekce písma: pokud jméno obsahuje znak mimo latinku (rozsahy pro azbuku, řečtinu, CJK, arabské písmo, hebrejštinu, dévanágarí), přidá se varování `non_latin_script` a vokativ se nepočítá vůbec, protože česká morfologie na takové jméno nedává smysl. Uloží se jen jméno tak, jak přišlo.

#### 4.4.2 Oddělení titulů

Tokenizace podle mezer. Token je titul, když se po odstranění koncové tečky a převodu na malá písmena bez diakritiky shoduje s položkou v jednom ze dvou slovníků.

**Tituly před jménem** (`title_prefix`): `ing`, `mgr`, `bc`, `bca`, `mga`, `judr`, `mudr`, `mvdr`, `phdr`, `rndr`, `pharmdr`, `thdr`, `thlic`, `paeddr`, `rsdr`, `mddr`, `prof`, `doc`, `dr`, `akad`, `arch`, `npor`, `por`, `kpt`, `mjr`, `pplk`, `plk`, `gen`, `p`, `pí`, `pan`, `pani`.

**Tituly za jménem** (`title_suffix`): `ph.d`, `phd`, `csc`, `drsc`, `dis`, `mba`, `ll.m`, `llm`, `msc`, `ba`, `ma`, `th.d`, `dba`, `mpa`, `dr.h.c`.

Pravidla:
- Prefixy se sbírají od začátku, dokud token odpovídá slovníku. `Ing. arch. Jan Novák` → prefix `Ing. arch.`, jméno `Jan Novák`. Vícedílné prefixy (`akad. arch.`, `Ing. arch.`, `MUDr. et MUDr.`) vzniknou přirozeně tím, že se sbírá víc tokenů za sebou. Spojka `et` a `&` mezi dvěma tituly se považuje za součást prefixu.
- Všechno za první čárkou v hodnotě se považuje za sufixové tituly. `Novák Jan, Ph.D., MBA` → jméno `Novák Jan`, sufix `Ph.D., MBA`. Výjimka: když je čárka jediná a to, co následuje, není v sufixovém slovníku, je čárka signálem obráceného pořadí (viz 4.4.3), ne titulem. `Nováková, Jana` → obrácené pořadí.
- Sufixy se sbírají i od konce bez čárky, pokud odpovídají slovníku.
- Původní tvar včetně teček a velikosti písmen se zachovává tak, jak byl v souboru.
- Token `pan`, `paní`, `p.` na začátku se odstraní a **použije se jako signál rodu** (`pan` → male, `paní` → female), ale neuloží se do `title_prefix`.

#### 4.4.3 Rozdělení jednoho sloupce na jméno a příjmení

Vstupem jsou tokeny `T = [t1..tn]` po odstranění titulů.

| Situace | Rozhodnutí | `nameSplitConfidence` |
|---|---|---|
| `n = 0` | chyba `name_empty`, jméno zůstane prázdné | `none` |
| `n = 1`, token končí na `ová`, `ská`, `cká`, `ova`, `ska`, `cka`, `ů` | příjmení | `high` |
| `n = 1`, token je ve slovníku křestních jmen | křestní jméno | `high` |
| `n = 1`, ostatní | **křestní jméno** | `low` |
| `n = 2`, uživatel zvolil pořadí (`options.name_order`) | podle volby uživatele | `high` |
| `n = 2`, v původní hodnotě byla mezi tokeny čárka | `t1` = příjmení, `t2` = křestní | `high` |
| `n = 2`, `t1` končí na příjmení-marker (`ová`, `ská`, `cká`, `ov`, `ev`, `ský`, `cký`, `ý`) **a zároveň** `t2` je ve slovníku křestních jmen | `t1` = příjmení, `t2` = křestní | `high` |
| `n = 2`, `t2` je ve slovníku křestních jmen a `t1` není | `t1` = příjmení, `t2` = křestní | `low` |
| `n = 2`, ostatní | `t1` = křestní, `t2` = příjmení | `high` pokud je `t1` ve slovníku, jinak `low` |
| `n ≥ 3`, obsahuje předložkovou částici | částice a všechno za ní je příjmení, zbytek křestní + prostřední | `high` |
| `n ≥ 3`, `t1` je ve slovníku vietnamských příjmení | `t1` = příjmení, `tn` = křestní, prostřední do `middle_name`, varování `vietnamese_order_assumed` | `low` |
| `n ≥ 3`, ostatní | `tn` = příjmení, `t1` = křestní, `t2..t(n-1)` = `middle_name` | `low` |

Předložkové a šlechtické částice: `van`, `von`, `de`, `del`, `della`, `da`, `di`, `du`, `des`, `la`, `le`, `ze`, `z`, `y`, `bin`, `ibn`, `al`, `abu`, `mac`, `mc`, `o'`, `ter`, `ten`, `vander`.

Vietnamská příjmení (nejčastější v ČR): `nguyen`, `nguyễn`, `tran`, `trần`, `le`, `lê`, `pham`, `phạm`, `hoang`, `hoàng`, `huynh`, `huỳnh`, `phan`, `vu`, `vũ`, `vo`, `võ`, `dang`, `đặng`, `bui`, `bùi`, `do`, `đỗ`, `ho`, `hồ`, `ngo`, `ngô`, `duong`, `dương`, `ly`, `lý`. Kolize: `Le` je zároveň vietnamské příjmení a francouzská částice. Pravidlo: pokud je `le` prvním tokenem a `n ≥ 3`, vyhrává vietnamská interpretace; jinak je to částice.

Nedělitelné celky: pomlčkou spojená příjmení (`Novák-Dvořák`, `Nováková-Dvořáková`) a jména s apostrofem (`O'Brien`, `D'Angelo`) jsou vždy jeden token, pomlčka ani apostrof se nedělí.

Když jsou `firstName` a `lastName` na vstupu samostatně, žádné dělení se nedělá a `nameSplitConfidence` je `high`.

#### 4.4.4 Určení rodu

Priorita, první pravidlo, které vrátí výsledek, vyhrává:

| # | Pravidlo | `genderSource` | Výsledná jistota |
|---|---|---|---|
| 1 | Explicitní hodnota ze zdroje (sloupec, pole API, pole formuláře, oslovení „pan"/„paní") | `explicit` | `high` |
| 2 | `name_overrides` pro `first` nebo `last` v tomto projektu | `workspace_override` | `high` |
| 3 | Příjmení končí na `ová`, `ská`, `cká`, `žská`, nebo je adjektivní ženské (`á` po souhlásce, typicky `Novotná`, `Malá`, `Tichá`) | `surname_rule` | `high` |
| 4 | Příjmení končí na `ova`, `eva`, `ska`, `cka`, `aya` (transliterace bez diakritiky) | `surname_rule_translit` | `low` |
| 5 | Křestní jméno ve slovníku, jednoznačné | `given_name_dict` | `high` |
| 6 | Křestní jméno ve slovníku, označené jako obourodé | `given_name_dict` | `low` |
| 7 | `isWoman()` z knihovny `czech-vocative` | `library_heuristic` | `low` |
| 8 | nic z toho | `none` | `none`, rod `unknown` |

**Konflikt.** Když pravidlo 3 nebo 4 řekne „žena" a pravidlo 5 řekne „muž" (nebo naopak, typicky při prohozených sloupcích), výsledný rod je `unknown`, jistota `low`, varování `gender_conflict`, a kontakt jde do fronty ke kontrole s oběma návrhy. Konflikt je cenná informace o vadném souboru, ne šum.

**Slovník křestních jmen.** Vlastní datový soubor `packages/core/contacts/naming/given-names.json`, cíl 4 000 až 6 000 položek pro češtinu a slovenštinu. Struktura:

```json
{ "petr": { "g": "m" }, "jana": { "g": "f" }, "nikola": { "g": "f", "ambiguous": true },
  "rene": { "g": "m", "ambiguous": true }, "saša": { "g": "u", "ambiguous": true } }
```

Klíč je jméno převedené na malá písmena, NFD a zbavené kombinovacích znaků, takže `Tomáš` i `Tomas` trefí klíč `tomas`. Slovník je součástí repozitáře, nikoliv externí služba. Zdroj dat je otevřený seznam českých a slovenských křestních jmen; před zařazením se ověří licence a uvede v `NOTICE`. **Do doby, než slovník existuje, modul funguje i bez něj** (pravidla 5 a 6 se přeskočí), jen se zvýší podíl `low`.

Obourodá jména, která slovník musí obsahovat s příznakem `ambiguous`, protože jsou v českém prostředí reálně sporná: `Nikola`, `Jindra`, `Saša`, `Míša`, `Andrea`, `René`, `Vali`, `Alex`, `Kim`, `Toni`, `Sam`, `Dominique`, `Simone`.

#### 4.4.5 Ověřené chování knihovny `czech-vocative`

Ověřeno 2026-07-31 instalací verze 2.1.0 a spuštěním testovací baterie 180 jmen. Zjištění, která přímo řídí návrh:

**API** (skutečná deklarace z `dist/index.d.ts`):

```ts
declare function isWoman(nameString: string): boolean;
declare function vocative(nameString: string, womanBool?: boolean, lastName?: boolean): string;
```

**Jak to uvnitř funguje.** Tři JSON tabulky přípon, žádný slovník jmen: 353 přípon pro mužský vokativ (výchozí hodnota při neshodě je `"e"`), 720 přípon pro rozlišení muž versus žena (výchozí `"m"`), 107 přípon pro rozlišení ženského křestního jména od příjmení (výchozí `"l"`, tedy příjmení). Ženské příjmení se vrací **beze změny** (což je správně), ženské křestní jméno končící na `a` dostane `o`, jinak se také vrací beze změny. Mužské jméno se **vždy** transformuje podle tabulky přípon.

**Změřený výkon:** 200 000 kontaktů, `isWoman` plus dvě volání `vocative`, 144 ms celkem, tedy **0,72 µs na kontakt** a zhruba **1,39 milionu kontaktů za sekundu na jedno jádro** (Node v24.2.0, Apple Silicon). Na 5 milionů kontaktů to je 3,6 sekundy procesorového času. Výpočet vokativu není a nebude úzké hrdlo importu.

**Vybrané ověřené výstupy** (sloupec „auto" je volání bez dalších parametrů, tedy `vocative(name)`):

| Vstup | `isWoman` | auto | s rodem, jako křestní | s rodem, jako příjmení | Hodnocení |
|---|---|---|---|---|---|
| `Jana` | true | `Jano` | `Jano` (f) | `Jana` (f) | správně |
| `Petr` | false | `Petře` | `Petře` (m) | `Petře` (m) | správně |
| `Jan` | false | `Jane` | `Jane` (m) | `Jane` (m) | správně |
| `Marie` | true | `Marie` | `Marie` (f) | `Marie` (f) | správně, nemění se |
| `Lucie` | true | `Lucie` | `Lucie` (f) | `Lucie` (f) | správně |
| `Jiří` | false | `Jiří` | `Jiří` (m) | `Jiří` (m) | správně, nemění se |
| `Hugo` | false | `Hugo` | `Hugo` (m) | `Hugo` (m) | správně |
| `René` | false | `René` | `René` (m) | `René` (m) | správně |
| `Dagmar` | true | `Dagmar` | `Dagmar` (f) | `Dagmar` (f) | správně |
| `Ester` | true | `Ester` | `Ester` (f) | `Ester` (f) | správně |
| `Novák` | false | `Nováku` | | `Nováku` (m) | správně |
| `Nováková` | true | `Nováková` | | `Nováková` (f) | správně |
| `Havel` | false | `Havle` | | `Havle` (m) | správně, vypadávající „e" |
| `Ježek` | false | `Ježku` | | `Ježku` (m) | správně |
| `Svoboda` | false | `Svobodo` | | `Svobodo` (m) | správně, mužské příjmení na `-a` |
| `Procházka` | false | `Procházko` | | `Procházko` (m) | správně |
| `Tichý` | false | `Tichý` | | `Tichý` (m) | správně, adjektivní příjmení se nemění |
| `Novotná` | true | `Novotná` | | `Novotná` (f) | správně |
| `Nikola` | **true** | `Nikolo` | | | rod uhodnutý, u muže špatně |
| `Jindra` | **false** | `Jindro` | | | rod uhodnutý, u ženy sporné |
| `Nováková` | | | | **`Novákováe`** (vynucený mužský rod) | **poškozený výstup** |
| `Novotná` | | | | **`Novotnáe`** (vynucený mužský rod) | **poškozený výstup** |
| `Zhang` | **true** | `Zhang` | | | rod náhodný |
| `Sarah` | **true** | `Sarah` | | | správně náhodou |
| `Thi` | **true** | `Thi` | | | rod náhodný |
| `Kim` | false | `Kime` | | | rod náhodný |
| `Nguyen` | false | `Nguyene` | | | česky obhajitelné, ale je to příjmení |
| `García` | false | `Garcío` | | | nežádoucí, španělské příjmení |
| `` (prázdné) | false | **`e`** | | | **musíme ošetřit sami** |
| `  Jan  ` | false | **`  Jan  e`** | | | **vstup se netrimuje** |
| `X` | false | **`XI`** | | | jednoznakový vstup |
| `Jan123` | false | `Jan123e` | | | **musíme ošetřit sami** |
| `Marie Anna` | true | `Marie Anno` | | | víceslovný vstup se nedělí |

Závěry, které z toho plynou pro náš kód:

1. **Nikdy nevolat s vynuceným mužským rodem, když si rodem nejsme jistí.** Kombinace ženského příjmení a `womanBool = false` vyrobí zjevný nesmysl (`Novákováe`). Když je rod `unknown`, voláme knihovnu **v automatickém režimu** (`vocative(name)`), jehož výsledek je nejhůř identita.
2. **Vstup musí být předem normalizovaný a ověřený.** Knihovna netrimuje, neodmítá prázdný řetězec, číslice ani emoji. To je naše odpovědnost.
3. **Víceslovné hodnoty se musí rozdělit před voláním.**
4. **`isWoman()` je jen poslední záchrana.** Je čistě příponová a na neceských jménech vrací v podstatě náhodu. Proto je v prioritním pořadí až na sedmém místě a vždy vede na jistotu `low`.
5. **Ženská větev je bezpečná, mužská ne.** Pro ženu je nejhorší výsledek beze změny; pro muže se vždy něco připojí. Proto se u `unknown` rodu nikdy nespoléhá na mužskou větev.

**Zvažované alternativy.**

| Knihovna | Licence | Verdikt |
|---|---|---|
| `czech-inflection` 1.1.1 | **LGPL v2.1** | Zakázaná. V JavaScriptu se bundluje, argument o dynamickém linkování neobstojí. Navíc poslední změna 2022-04-28 |
| `vokativ` 1.0.1 | MIT, 2 855 stažení týdně, poslední změna 2023-05-10 | Předchůdce `czech-vocative`. Stejný algoritmus, obsahuje odstraněný zastaralý kód, méně stažení, půl druhého roku bez aktualizace |
| Vlastní implementace přípon | n/a | Znamenalo by přepsat a udržovat 353 pravidel. Pro MVP 0 nepřiměřené. Zůstává jako záložní cesta: knihovna je MIT a datové soubory jsou obyčejný JSON, takže fork je triviální |
| Externí služba (API na skloňování) | n/a | V rozporu s pravidlem 4 hlavní specifikace (nulová povinná komunikace s cizím cloudem) |

**Volba: `czech-vocative` 2.1.0**, obalená vlastní vrstvou, která řeší normalizaci, rod, jistotu a fallbacky. Riziko projektu jednoho dodavatele je nízké, protože jde o 90 řádků kódu a tři JSON tabulky pod MIT.

#### 4.4.6 Výpočet vokativu

```
if (locale nemá vokativ)                       → vokativ = nominativ, confidence = 'high'
if (jméno má NON_LATIN_SCRIPT)                 → vokativ = null,      confidence = 'none'
if (name_overrides.vocative existuje)          → vokativ = override,  confidence = 'high'
if (gender ∈ {female, male})
      firstNameVocative = vocative(firstName, gender === 'female', false)
      lastNameVocative  = vocative(lastName,  gender === 'female', true)
else  firstNameVocative = vocative(firstName)          // automatický režim knihovny
      lastNameVocative  = vocative(lastName, undefined, true)
```

Jistota se odvodí z tabulky v 4.4.4 a pak se **sníží na `low`**, pokud platí kterákoliv z podmínek:

| Podmínka | Důvod |
|---|---|
| jméno obsahuje znak mimo `[A-Za-zÁ-žÀ-ÿ'\- ]` | číslice, emoji, cizí písmo |
| délka jména < 2 nebo > 40 znaků | `X` → `XI` |
| výsledek je o víc než 3 znaky delší než vstup | pojistka proti `Novákováe` |
| rod byl určen jinak než pravidly 1 až 3 nebo 5 | odvozeno v 4.4.4 |
| jméno obsahuje mezeru i po rozdělení | nezpracované víceslovné jméno |
| výsledek se rovná vstupu, rod je `male` a jméno nekončí na `í`, `ý`, `é`, `o`, `u`, `i` | příponová tabulka se netrefila |

Jistota `none` znamená, že vokativ je `null`.

#### 4.4.7 Oslovení `contact.greeting`

`greeting` je hotový řetězec uložený ve sloupci, ne funkce v šabloně. Důvody jsou v kapitole 6.3 hlavní specifikace a beze zbytku platí.

Algoritmus podle dvojice (`workspaces.address_form`, `settings.contacts.salutation_by`), s ohledem na `settings.contacts.vocative_policy` (`strict` použije jen `high`, `balanced` použije `high` i `low`; výchozí je `balanced`):

```
useVocative = vocativeConfidence === 'high'
              || (vocativePolicy === 'balanced' && vocativeConfidence === 'low')
```

Zkratky v tabulce: `formal_vy` = (`formal`, `first_name`), `informal_ty` = (`informal`, `first_name`), `formal_surname` = (`formal`, `surname`).

| Režim | Podmínka | Výsledek (cs) | Výsledek (en) |
|---|---|---|---|
| `formal_surname` | rod ∈ {male, female}, `lastNameVocative` neprázdné, `useVocative` | `Vážený pane Nováku,` / `Vážená paní Nováková,` | `Dear Mr Novák,` / `Dear Ms Nováková,` |
| `formal_surname` | jinak | spadne na `formal_vy` | spadne na `formal_vy` |
| `formal_vy` | `firstNameVocative` neprázdné a `useVocative` | `Dobrý den, Jano` | `Hello Jana` |
| `formal_vy` | jinak | `Dobrý den` | `Hello` |
| `informal_ty` | `firstNameVocative` neprázdné a `useVocative` | `Ahoj Jano` | `Hi Jana` |
| `informal_ty` | jinak | `Ahoj` | `Hi` |

Testovací vektory, které musí projít (projekt `cs`, `address_form = formal`, `salutation_by = first_name`, `vocative_policy = balanced`):

| first_name | last_name | gender | greeting |
|---|---|---|---|
| `Jana` | `Nováková` | female | `Dobrý den, Jano` |
| `Petr` | `Novák` | male | `Dobrý den, Petře` |
| `Marie` | `Dvořáková` | female | `Dobrý den, Marie` |
| `Jiří` | `Svoboda` | male | `Dobrý den, Jiří` |
| `` | `` | unknown | `Dobrý den` |
| `` | `Novák` | male | `Dobrý den` |
| `Nikola` | `Krátká` | female | `Dobrý den, Nikolo` |
| `Nikola` | `Krátký` | unknown | `Dobrý den, Nikolo` (jistota `low`, ve frontě ke kontrole) |
| `Zhang` | `Wei` | unknown | `Dobrý den` (varování `non_latin_script` neplatí, ale jistota je `low` kvůli slovníku; při `strict` politice by to bylo `Dobrý den`) |
| `Иван` | `Петров` | unknown | `Dobrý den` (`non_latin_script`) |

**`greeting_neutral`: druhá, vždy bezpečná varianta.**

Část 4a slibuje uživateli před odesláním tlačítko „Poslat s neutrálním oslovením" (viz 4.5.4). Aby ho mohla splnit, potřebuje mít z čeho ten neutrální tvar vzít. `greeting` je jeden hotový řetězec a logika, která by z něj zpětně odstranila jméno, žije tady a nikdo ji nechce ani v senderu, ani v materializaci.

Řešení je druhý sloupec `greeting_neutral`, počítaný **stejným kódem a stejným jobem** jako `greeting`, jen s vynuceným `useVocative = false`:

| Režim | `greeting` (příklad) | `greeting_neutral` |
|---|---|---|
| `formal_vy`, cs | `Dobrý den, Jano` | `Dobrý den` |
| `informal_ty`, cs | `Ahoj Jano` | `Ahoj` |
| `formal_surname`, cs | `Vážená paní Nováková,` | `Dobrý den` |
| `formal_vy`, en | `Hello Jana` | `Hello` |
| jakýkoliv, jméno neznámé | `Dobrý den` | `Dobrý den` |

U drtivé většiny kontaktů jsou obě hodnoty shodné, takže reálná cena je pár desítek MB na pět milionů kontaktů. Zvažoval jsem alternativu ukládat jen příznak a skládat neutrální tvar až v materializaci, ale znamenalo by to mít pravidla pro oslovení na dvou místech, což je přesně ta chyba, kterou kapitola 6.3 hlavní specifikace u vokativu zakazuje.

**Jak to použije materializace publika** (část 4a, viz požadavek 4.12):

```sql
CASE WHEN $neutral AND c.vocative_confidence = 'low' AND c.vocative_locked = false
     THEN c.greeting_neutral
     ELSE c.greeting
END AS greeting
```

Podmínka je `low AND NOT locked`, ne jen `low`, protože **potvrzený nízký odhad už není nejistý**. Je to tatáž definice jako fronta ke kontrole ve 4.5.1 a jako počet v předodesílacím dialogu ve 4.5.4, takže číslo, které uživatel vidí („u 143 kontaktů si nejsme jistí"), přesně odpovídá počtu kontaktů, u kterých se přepnutím něco změní. Kdyby se podmínky lišily, uživatel by klikl na tlačítko a dostal jiný výsledek, než jaký mu dialog sliboval.

Pro `vocative_confidence = 'none'` se nic nepřepíná, protože `greeting` je v tom případě už z definice neutrální.

`greeting_neutral` se přepočítává vždy zároveň s `greeting`, stejnými spouštěči.

**Nikdy nesmí vzniknout `Dobrý den, ` s visící čárkou.** Je to samostatné akceptační kritérium a je pokryté testem, který projde všechny kombinace prázdných a neprázdných polí.

Pole `greeting` i `greeting_neutral` se přepočítávají při každé změně `first_name`, `last_name`, `gender`, vokativů nebo `locale`. Změna `workspaces.address_form`, `settings.contacts.salutation_by` nebo `settings.contacts.vocative_policy` spustí job `contacts.recompute_greeting` pro celý projekt, dávky 10 000 řádků, u 5 milionů kontaktů zhruba 500 dávek a jednotky minut.

#### 4.4.8 Zámek ruční opravy

`vocative_locked = true` znamená, že hodnotu zadal nebo potvrdil člověk a přepočet ji nesmí přepsat. Zároveň se uloží `vocative_locked_for = first_name || '|' || last_name` v době zamknutí.

Chování při dalším zápisu:

| Situace | Chování |
|---|---|
| Zápis nemění jméno ani příjmení | zámek drží, vokativ se nepřepočítává |
| Zápis mění jen rod | zámek drží, vokativ se nepřepočítává, ale `greeting` se přepočítá (rod ovlivňuje `formal_surname`) |
| Zápis mění jméno nebo příjmení | **zámek padá**: `vocative_locked = false`, vokativ se přepočítá, jistota `low`, kontakt jde znovu do fronty ke kontrole, do auditu se zapíše `contact.vocative_lock_released` s původním a novým jménem |
| Ruční editace vokativu v UI | zámek se nastaví, `vocative_reviewed_at = now()`, `vocative_confidence = 'high'` |

Zdůvodnění: zámek chrání hodnotu, ne jméno. Kdyby zůstal po změně jména, kontakt „Jana Nováková" přejmenovaný na „Petr Novák" by dál dostával oslovení „Jano".

### 4.5 Fronta ke kontrole vokativu

#### 4.5.1 Definice fronty

```sql
SELECT ... FROM contacts
WHERE workspace_id = $1
  AND vocative_confidence = 'low'
  AND vocative_locked = false
  AND deleted_at IS NULL
  AND status <> 'deleted'
  [AND source_ref = $2]        -- volitelně omezeno na jeden import
```

Pokrývá to částečný index 7 z 3.1.

#### 4.5.2 Seskupení

Fronta se **nikdy nezobrazuje po kontaktech**, vždy po skupinách. Klíč skupiny:

```
(lower(unaccent(first_name)), gender, first_name_vocative, kind='first')
```

Dotaz:

```sql
SELECT lower(first_name) AS name_key, gender, first_name_vocative,
       count(*) AS contact_count, min(id) AS sample_contact_id,
       array_agg(DISTINCT last_name ORDER BY last_name) FILTER (WHERE last_name IS NOT NULL) AS sample_surnames
FROM contacts
WHERE workspace_id = $1 AND vocative_confidence = 'low'
  AND vocative_locked = false AND deleted_at IS NULL AND first_name IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY contact_count DESC
LIMIT 50;
```

Import 3 000 kontaktů s 143 nejistými typicky vyrobí 30 až 60 skupin, ne 143 řádků. To je rozdíl mezi „proklikám to za dvě minuty" a „na to nemám čas".

Analogická fronta existuje pro příjmení, ale zobrazuje se jen když je `salutation_by = 'surname'`, protože jinak se příjmení v oslovení nepoužívá.

#### 4.5.3 Operace nad skupinou

| Operace | Efekt |
|---|---|
| Potvrdit návrh | u všech kontaktů skupiny `vocative_locked = true`, `vocative_confidence = 'high'`, `vocative_reviewed_at = now()`, přepočet `greeting` |
| Opravit vokativ | zadaná hodnota se zapíše do `first_name_vocative` všem kontaktům skupiny, pak jako výše |
| Nastavit rod | zapíše `gender`, `gender_source = 'manual'`, přepočítá vokativ i `greeting`, pak jako výše |
| Nepoužívat jméno | `first_name_vocative = NULL`, `vocative_confidence = 'high'`, `vocative_locked = true`; `greeting` spadne na neutrální tvar |
| Uložit i pro budoucí kontakty | navíc `INSERT INTO name_overrides`, takže příští import to už nevyhodí |
| Odložit skupinu | `vocative_confidence` zůstává `low`, jen se skupina schová z výchozího pohledu (uloženo v `attributes` uživatele, ne kontaktu) |

Volba „uložit i pro budoucí kontakty" je ve výchozím stavu **zaškrtnutá**. Bez ní fronta konverguje k nule jen náhodou.

Hromadná operace nad skupinou do 5 000 kontaktů běží synchronně v jedné transakci. Nad 5 000 se zařadí job `contacts.bulk_vocative_review` s dávkami po 5 000 a UI ukáže průběh. Skupina se uzamkne proti souběžné editaci přes `SELECT ... FOR UPDATE` na `name_overrides` řádku, respektive přes pg-boss `singletonKey`.

#### 4.5.4 Kontrola před odesláním

Kampaň, jejíž šablona používá `{{ contact.greeting }}` nebo `{{ contact.first_name_vocative }}`, zobrazí před odesláním upozornění:

> **U 143 kontaktů z 3 214 si nejsme jistí oslovením.**
> Zkontrolovat teď · Poslat s neutrálním oslovením · Poslat tak, jak je

Volba „poslat s neutrálním oslovením" nastaví u dotčených kontaktů `first_name_vocative = NULL` **jen pro tuto kampaň**, přes příznak v materializaci publika (viz požadavek 11.3), nikoliv zápisem do kontaktů. Dotaz na počet:

```sql
SELECT count(*) FROM contacts c
WHERE c.workspace_id = $1 AND c.id = ANY($2)   -- publikum kampaně
  AND c.vocative_confidence = 'low' AND c.vocative_locked = false;
```

Anglický text: „We are not sure how to address 143 out of 3,214 contacts."

### 4.6 Import CSV

#### 4.6.1 Limity

| Limit | Hodnota | Konfigurace |
|---|---|---|
| Velikost souboru | 200 MB | `IMPORT_MAX_FILE_BYTES` = 209715200 |
| Počet řádků | 5 000 000 | `IMPORT_MAX_ROWS` |
| Počet sloupců | 200 | `IMPORT_MAX_COLUMNS` |
| Délka jedné buňky | 8 192 znaků | `IMPORT_MAX_CELL_CHARS` |
| Délka jednoho řádku | 64 kB | `IMPORT_MAX_LINE_BYTES` |
| Velikost dávky | 1 000 řádků | `IMPORT_BATCH_SIZE` |
| Uložených chybných řádků | 10 000 | `IMPORT_MAX_STORED_ERRORS` |
| Souběžných importů na projekt | 1 | pevné |
| Souběžných importů globálně | 2 | `IMPORT_WORKER_CONCURRENCY` |
| Vzorek pro detekci kódování | 256 kB | `IMPORT_SNIFF_BYTES` |
| Retence nahraného souboru | 30 dní | politika `import_files` |
| Životnost stavu `previewing` | 24 h | `IMPORT_PREVIEW_TTL_HOURS` |

Soubor se **nikdy nenačítá do paměti celý.** Nahrává se proudem do `${DATA_DIR}/imports/{workspace_id}/{import_id}.csv` (nebo do S3, když je nakonfigurované), a zpracovává se proudovým parserem po dávkách.

#### 4.6.2 Detekce kódování

Ověřený algoritmus, v tomto pořadí:

1. **BOM.** `EF BB BF` → UTF-8 (BOM se zahodí). `FF FE` → UTF-16LE. `FE FF` → UTF-16BE. `FF FE 00 00` nebo `00 00 FE FF` → UTF-32, odmítnuto s `unsupported_encoding`. `encoding_source = 'bom'`.
2. **Striktní validace UTF-8** prvních 256 kB, oříznutých na poslední úplný kódový bod. Když projde (`TextDecoder('utf-8', { fatal: true })` nevyhodí výjimku), kódování je UTF-8. `encoding_source = 'utf8_validation'`. Čistě ASCII soubor sem spadne také, což je správně.
3. **Skóre kandidátů.** Vzorek se dekóduje kandidáty `windows-1250`, `ISO-8859-2`, `windows-1252`, `ISO-8859-1` a každý dostane skóre:

   ```
   score = 2 × počet znaků z "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ"
         − 3 × počet znaků z "¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷"
   ```

   Vyhrává nejvyšší skóre, při rovnosti `windows-1250`. `encoding_source = 'score'`.

**Proč zrovna takhle a ne detektorem.** Ověřeno 2026-07-31: knihovna `chardet` 2.2.0 (MIT) vrátila pro **skutečná data v CP1250** s českou diakritikou výsledek `windows-1252`, a to jak pro vzorek 166 bajtů, tak pro 7 kB. Kandidáti `windows-1250` a `windows-1252` skončili se stejnou důvěrou 26, respektive 20 procent. Statistický detektor tyhle dvě kódové stránky prakticky nerozliší, protože se liší jen v horní polovině a mají podobné rozložení bajtů. Skóre podle českých písmen naopak rozhodlo správně ve všech měřených případech:

| Zdroj | `windows-1250` | `windows-1252` | `ISO-8859-2` | `ISO-8859-1` | Vybráno |
|---|---|---|---|---|---|
| CP1250 | **28** | 10 | 18 | 2 | `windows-1250` (správně) |
| ISO-8859-2 | 9 | −13 | **28** | −13 | `ISO-8859-2` (správně) |
| Windows-1252 (bez české diakritiky) | 16 | 16 | 8 | 8 | `windows-1250` (rozstřel, obsah je ASCII, na výsledku nezáleží) |

`chardet` se proto **jako závislost nepřidává**. Dekódování obstará `iconv-lite`.

Zjištěné kódování se zobrazí v náhledu s možností ručního přepsání (`encoding_source = 'manual'`). Když se během zpracování narazí na bajty, které v deklarovaném kódování nedávají smysl, řádek dostane `encoding_error` a import pokračuje.

#### 4.6.3 Detekce oddělovače a tvaru CSV

- Kandidáti v pořadí priority: `;`, `,`, `\t`, `|`. Středník je první, protože český Excel exportuje se středníkem a je to nejčastější případ.
- Na prvních 20 neprázdných řádcích dekódovaného vzorku se pro každého kandidáta spočítá počet polí na řádek, s respektem k uvozovkám.
- Skóre = počet řádků, jejichž počet polí se rovná modu. Rozstřel: vyšší modus, pak pořadí priority.
- Modus musí být alespoň 2, jinak `delimiter_not_detected` a uživatel musí vybrat ručně.
- Uvozovka je vždy `"`, escapování zdvojením podle RFC 4180. Když vzorek obsahuje `\"` a neobsahuje `""`, přepne se na escapování zpětným lomítkem.
- Konce řádků `\r\n`, `\n` i `\r` jsou přijatelné a míchat se smí.
- Hlavička se předpokládá, když je v prvním řádku každá buňka neprázdná, není čistě číselná a všechny jsou jedinečné. Jinak `has_header = false` a sloupce se pojmenují `Sloupec 1`, `Sloupec 2`. Uživatel může přepnout.

#### 4.6.4 Mapování sloupců

```ts
// Klíče v JSON těle jsou snake_case podle konvence 4.1 části 1.
type ImportMapping = {
  [csv_column_index: string]:
    | { target: 'email' | 'first_name' | 'last_name' | 'full_name' | 'middle_name'
              | 'title_prefix' | 'title_suffix' | 'gender' | 'locale' | 'timezone'
              | 'consent_occurred_at' | 'consent_source' | 'ignore' }
    | { target: 'attribute'; key: string }
    | { target: 'tag' }                        // hodnota se rozdělí na `,` nebo `|`
    | { target: 'list'; list_id: string };     // hodnota se interpretuje jako boolean
};
```

Automatické mapování podle názvu hlavičky, porovnání bez diakritiky a velikosti písmen:

| Cíl | Rozpoznávaná záhlaví |
|---|---|
| `email` | `email`, `e-mail`, `mail`, `emailova adresa`, `e-mailová adresa`, `email address` |
| `first_name` | `jmeno`, `jméno`, `krestni`, `křestní jméno`, `first name`, `given name`, `firstname` |
| `last_name` | `prijmeni`, `příjmení`, `last name`, `surname`, `family name`, `lastname` |
| `full_name` | `jmeno a prijmeni`, `cele jmeno`, `celé jméno`, `name`, `full name`, `nazev` |
| `gender` | `pohlavi`, `pohlaví`, `rod`, `gender`, `sex`, `osloveni`, `oslovení` |
| `title_prefix` | `titul`, `titul pred`, `title` |
| `locale` | `jazyk`, `language`, `locale`, `jazyk komunikace` |

Když je namapované `full_name` a zároveň `first_name`, vyhrávají samostatná pole a `full_name` se ignoruje s varováním v náhledu.

Nenamapované sloupce mají výchozí cíl `ignore`. U každého UI nabídne „vytvořit vlastní pole", což založí `contact_fields` s odhadnutým typem podle prvních 100 hodnot (všechno číselné → `number`, všechno `ano`/`ne` → `boolean`, méně než 20 různých hodnot a všechny krátké → `enum`, jinak `text`).

Povinnost: musí být namapovaný právě jeden sloupec na `email`, jinak `no_email_column_mapped`.

#### 4.6.5 Volby importu

```ts
type ImportOptions = {
  on_conflict: 'skip' | 'update' | 'overwrite';         // výchozí 'update'
  duplicate_in_file: 'last' | 'first' | 'error';        // výchozí 'last'
  name_order: 'auto' | 'first_last' | 'last_first';     // výchozí 'auto'
  split_full_name: boolean;                             // výchozí true
  trim_whitespace: boolean;                             // výchozí true
  empty_means_null: boolean;                            // výchozí true
  number_format: 'auto' | 'cs' | 'en';                  // výchozí podle projektu
  date_format: 'auto' | 'cs' | 'en';                    // výchozí podle projektu

  list_ids: string[];                                   // do kterých seznamů přihlásit
  subscription_status: 'pending' | 'confirmed';         // výchozí 'pending'
  send_confirmation_emails: boolean;                    // výchozí false
  tag_ids: string[];

  consent: {
    purpose: 'email_marketing';
    legal_basis: 'consent' | 'legitimate_interest' | 'soft_opt_in';
    source: string;
    consent_text?: string;
    declaration: boolean;                               // "mám doložitelný souhlas"
  } | null;

  skip_suppressed: boolean;                             // výchozí true, u complaint nelze vypnout
  dry_run: boolean;                                     // výchozí false
};
```

Neznámý klíč v `options` je odmítnutý (`zod.strict()` podle 4.1 části 1), takže překlep `on_conflct` skončí `422 validation_failed`, ne tichým použitím výchozí hodnoty.

`subscription_status: 'confirmed'` na seznamu s `opt_in = 'double'` je povolené jen tehdy, když `consent.declaration = true`. UI u toho ukáže text: „Potvrzuji, že mám k těmto adresám doložitelný souhlas se zasíláním obchodních sdělení. Uloží se jako důkaz včetně data a mého jména." Zaškrtnutí se ukládá do `imports.options` i do `consents.evidence`.

#### 4.6.6 Náhled

Náhled ukáže **prvních 20 datových řádků** po namapování a koerci, ve výsledné podobě, tedy včetně:

- rozdělení jména na titul, křestní jméno, příjmení,
- odvozeného rodu a jeho zdroje,
- **navrženého vokativu a hotového oslovení** (`Dobrý den, Pavle`),
- koercovaných hodnot vlastních polí (aby bylo vidět, že „44927" je datum a „1,234" je 1,234),
- řádků, které by skončily chybou, zvýrazněných červeně s kódem a popisem,
- řádků na suppression listu, zvýrazněných šedě.

Nad tabulkou souhrn: „Rozpoznáno: kódování windows-1250, oddělovač středník, hlavička ano. 3 214 řádků. Odhad: 2 980 nových, 202 aktualizovaných, 18 přeskočených, 14 chybných. U 143 kontaktů si nebudeme jistí oslovením."

Odhad se počítá z celého souboru rychlým průchodem (jen e-mail a jméno, bez zápisu), ne z 20 řádků. U souboru nad 500 000 řádků se místo přesného odhadu zobrazí extrapolace z prvních 100 000 řádků a označí se jako přibližná.

#### 4.6.7 Zpracování řádku

Pořadí operací je závazné, protože určuje, která chyba se nahlásí první:

1. Dekódování bajtů řádku podle zjištěného kódování.
2. Parsování na pole. Neshoda počtu polí proti hlavičce → `row_field_count_mismatch`. Výjimka: řádek s menším počtem polí, kde chybí jen koncové sloupce, se doplní prázdnými hodnotami a dostane varování.
3. Ořez bílých znaků (`trim_whitespace`).
4. Extrakce a normalizace e-mailu podle 4.1.1. Prázdný → `email_missing`, neplatný → `email_invalid`, delší než 254 → `email_too_long`.
5. Kontrola duplicity uvnitř souboru. Podle `duplicate_in_file`: `last` znamená, že pozdější řádek přepíše dřívější a dřívější dostane varování `duplicate_in_file`; `first` znamená, že pozdější se zahodí; `error` znamená chybu na druhém výskytu. Detekce je přes hash-set e-mailů v paměti; při 5 milionech řádků a průměrné adrese 25 znaků jde o zhruba 400 MB, což je moc. Proto se od 1 000 000 řádků přepne na **detekci až v databázi** (`ON CONFLICT` sám vyřeší, pozdější vyhraje) a varování `duplicate_in_file` se nevydává; místo něj se do souhrnu importu zapíše poznámka. Práh je `IMPORT_INMEMORY_DEDUP_MAX_ROWS`.
6. Kontrola suppression listu. `complaint` a `gdpr_erasure` → řádek se zahodí (`suppressed_rows++`), kontakt nevznikne. Ostatní důvody → kontakt vznikne, ale bez přihlášení a bez souhlasu.
7. Rozdělení jména, určení rodu, výpočet vokativu a oslovení podle 4.4.
8. Koerce a validace vlastních polí podle 4.2.4. Chyba v jednom poli je chyba **celého řádku**, ne tichý zápis neúplného kontaktu.
9. Sestavení řádku do dávky.

#### 4.6.8 Dávkování, checkpoint a obnova

Dávka 1 000 řádků se zapisuje **v jedné transakci**, která obsahuje:

1. `INSERT ... ON CONFLICT` do `contacts` (viz 4.1.3),
2. `INSERT ... ON CONFLICT DO NOTHING` do `contact_tags`,
3. `INSERT ... ON CONFLICT DO UPDATE` do `list_subscriptions`,
4. `INSERT` do `consents` a `contact_consent_state`,
5. `INSERT` do `import_errors` pro chybné řádky dávky,
6. `UPDATE imports SET checkpoint_row = $1, checkpoint_byte = $2, processed_rows = ..., created_rows = ..., ...`.

Protože je bod 6 ve stejné transakci jako body 1 až 5, platí **exactly-once na úrovni dávky**: pád workera kdykoliv uprostřed znamená rollback celé dávky, a po restartu se čte od `checkpoint_row + 1`, respektive se soubor přeskočí na `checkpoint_byte`. Žádný řádek nemůže být zpracovaný dvakrát ani vynechaný. Navíc je celý zápis idempotentní sám o sobě (upsert), takže i případné opakování dávky je neškodné.

Job má `singletonKey = import_id` a `retryLimit = 0`. Obnovu řídí sám importér: při startu workera se najdou importy ve stavu `importing`, jejichž `updated_at` je starší než `IMPORT_STALE_MINUTES` (výchozí 10), a znovu se zařadí.

`checkpoint_byte` je bajtový offset **prvního bajtu následujícího nezpracovaného záznamu**. Parser ho zná, protože si drží pozici ve streamu. Přeskočení na offset je bezpečné, protože obě podporovaná kódování (UTF-8 i jednobajtové kódové stránky) jsou na hranici záznamu synchronizovatelná.

Po každé dávce se přes SSE (mechanismus vlastní část 1) pošle progres: `{ processed, total, created, updated, errors, eta_seconds }`.

#### 4.6.9 Idempotence

```
idempotency_key = base64url( sha256( content_sha256 || ':' || workspace_id || ':'
                                   || canonical_json(mapping) || ':' || canonical_json(options) ) )
```

Kanonický JSON znamená seřazené klíče a bez bílých znaků. Zahrnutí mapování a voleb je záměr: **tentýž soubor s jiným mapováním je jiný import**, a to je legitimní scénář (poprvé jen e-maily, podruhé i vlastní pole).

Chování při shodě:

- Existující import ve stavu `completed`, `completed_with_errors` nebo `importing` mladší než 24 hodin → `409 conflict` s `import_duplicate` a tělem `{ import_id, status, created_at, created_rows, ... }`. UI zobrazí „Tenhle soubor už jste s tímhle nastavením nahráli 31. 7. v 9:12. Chcete otevřít původní import, nebo ho spustit znovu?"
- Volba „spustit znovu" pošle `force: true`, což do klíče přidá náhodný nonce, takže vznikne nový import.
- Existující import ve stavu `failed` nebo `cancelled` → nový import se založí bez ptaní.

Hlavička `Idempotency-Key` na `POST /api/v1/contacts/imports` funguje nezávisle a chrání proti dvojímu odeslání téhož HTTP požadavku.

#### 4.6.10 Stavy importu

```
pending ──> validating ──> previewing ──> importing ──> completed
                │              │              │      └─> completed_with_errors
                │              │              └────────> cancelled
                └──────────────┴───────────────────────> failed
```

Tabulka přechodů:

| Z | Do | Spouštěč | Povoleno |
|---|---|---|---|
| `pending` | `validating` | worker si vyzvedne job | ano |
| `validating` | `previewing` | detekce a náhled hotové | ano |
| `validating` | `failed` | chyba na úrovni souboru | ano |
| `previewing` | `importing` | `POST /imports/{id}/confirm` | ano |
| `previewing` | `cancelled` | uživatel nebo TTL 24 h | ano |
| `importing` | `completed` | dojel, `error_rows = 0` | ano |
| `importing` | `completed_with_errors` | dojel, `error_rows > 0` | ano |
| `importing` | `cancelled` | `POST /imports/{id}/cancel` | ano, zpracované řádky zůstávají |
| `importing` | `failed` | neopravitelná chyba (nedostupné úložiště, plný disk) | ano |
| `completed*`, `failed`, `cancelled` | cokoliv | | **zakázáno**, terminální stavy |
| `previewing` | `validating` | změna mapování | **zakázáno**, změna mapování zakládá nový import (jiný `idempotency_key`) |

Zrušení uprostřed importu nechá už zapsané kontakty na místě. Do `failure_detail` se zapíše „zrušeno uživatelem na řádku 412 300 z 3 000 000". Nabízí se „pokračovat od místa zrušení", což vytvoří nový import s `resume_from_import_id` a `checkpoint_byte` z původního.

#### 4.6.11 Katalog chyb importu

Chyby na úrovni souboru (import končí jako `failed`):

| Kód | Kdy | Text pro uživatele (cs) |
|---|---|---|
| `file_too_large` | > 200 MB | Soubor je větší než 200 MB. Rozdělte ho na části. |
| `too_many_rows` | > 5 000 000 | Soubor má víc než 5 milionů řádků. |
| `too_many_columns` | > 200 | Soubor má víc než 200 sloupců. |
| `empty_file` | 0 datových řádků | Soubor neobsahuje žádná data. |
| `unsupported_encoding` | UTF-16/32 nebo nerozpoznáno | Kódování souboru neumíme přečíst. Uložte ho jako CSV UTF-8. |
| `delimiter_not_detected` | modus polí < 2 | Nepodařilo se rozpoznat oddělovač. Vyberte ho ručně. |
| `malformed_csv` | neuzavřená uvozovka na konci souboru | Soubor je poškozený, chybí uzavírací uvozovka. |
| `no_email_column_mapped` | při potvrzení | Musíte vybrat sloupec s e-mailem. |
| `storage_unavailable` | selhalo úložiště | Nepodařilo se uložit soubor. Zkuste to znovu. |
| `contact_limit_reached` | překročen `contact_limit` | Dosáhli jste limitu počtu kontaktů v projektu. |

Chyby na úrovni řádku (řádek se přeskočí, import pokračuje):

| Kód | Kdy |
|---|---|
| `row_field_count_mismatch` | jiný počet polí než v hlavičce |
| `email_missing` | prázdná adresa |
| `email_invalid` | neprošla syntaktická validace |
| `email_too_long` | > 254 znaků |
| `email_domain_invalid` | doména bez tečky nebo s neplatnými znaky |
| `email_disposable` | doména na seznamu jednorázových (jen když je seznam zapnutý) |
| `duplicate_in_file` | při `duplicate_in_file = 'error'` |
| `invalid_number`, `invalid_boolean`, `invalid_date`, `invalid_datetime` | koerce selhala |
| `invalid_enum_value` | hodnota není ve `values` |
| `invalid_url`, `invalid_phone` | |
| `value_too_long` | přes `max_length` pole |
| `required_field_missing` | pole s `required = true` je prázdné |
| `unknown_field_key` | mapování odkazuje na neexistující pole |
| `encoding_error` | bajty nedávají v deklarovaném kódování smysl |
| `name_empty` | `full_name` je prázdné, ale bylo namapované jako povinné |
| `list_not_found` | `list_id` z mapování neexistuje |

Varování (řádek se naimportuje, jen se označí):

| Kód | Kdy |
|---|---|
| `name_split_low_confidence` | rozdělení jména není jisté |
| `vietnamese_order_assumed` | použito vietnamské pořadí |
| `gender_unknown` | rod se nepodařilo určit |
| `gender_conflict` | příjmení a křestní jméno ukazují na jiný rod |
| `vocative_low_confidence` | vokativ jde do fronty ke kontrole |
| `non_latin_script` | jméno není v latince |
| `value_truncated` | hodnota zkrácena na `max_length` |
| `excel_serial_date_assumed` | číslo interpretováno jako datum z Excelu |
| `number_format_ambiguous` | `1,234` mohlo být 1,234 i 1234 |
| `suppressed_skipped` | adresa je na suppression listu |
| `trailing_fields_padded` | chybějící koncové sloupce doplněny prázdnem |

Stažení chybných řádků: `GET /api/v1/contacts/imports/{id}/errors.csv` vrátí CSV se **stejnou hlavičkou jako původní soubor** plus dva sloupce `_error_code` a `_error_detail`, ve stejném kódování a se stejným oddělovačem. Uživatel opraví a nahraje zpátky bez přemapování.

### 4.7 Export

`POST /api/v1/contacts/exports` s tělem `{ filter, columns, format, encoding, delimiter }`, kde `filter` je buď `{ segment_id }`, `{ list_id, status? }`, `{ ids: [...] }`, nebo inline segmentový AST.

- Výchozí kódování `utf-8-bom`. BOM je tam schválně: bez něj Excel v českém prostředí otevře UTF-8 CSV s rozbitou diakritikou, což je nejčastější stížnost na exporty vůbec. Volba `windows-1250` existuje pro starší systémy; znaky mimo CP1250 se nahradí `?` a do odpovědi se přidá `warning: 'characters_lost'`.
- Výchozí oddělovač `;` pro `cs`, `,` pro ostatní jazyky.
- Sloupce: pevná sada (`email`, `first_name`, `last_name`, `title_prefix`, `title_suffix`, `gender`, `first_name_vocative`, `greeting`, `status`, `locale`, `source`, `created_at`, `last_activity_at`) plus vybraná vlastní pole plus `tags` (spojené `|`) plus stav v každém vybraném seznamu.
- Běží jako job `contacts.export` s kurzorem na serveru (`DECLARE ... CURSOR`), dávky 5 000 řádků, výstup se zapisuje proudem do souboru a gzipuje.
- Odkaz ke stažení je jednorázový podepsaný token s platností 24 h. Po vypršení se soubor smaže (`idx_exports__expiry`).
- Limit: jeden běžící export na projekt, maximálně 10 exportů za hodinu.
- Ochrana proti CSV injection: buňka, která začíná na `=`, `+`, `-`, `@`, tabulátor nebo `\r`, se prefixuje apostrofem. Bez toho je export cesta, jak přes kontakt jménem `=cmd|'/c calc'!A1` spustit kód v tabulkovém procesoru příjemce.

### 4.8 Seznamy, přihlášení a double opt-in

#### 4.8.1 Stavový diagram

```
                       subscribe (single opt-in)
        ┌──────────────────────────────────────────────────────────┐
        │                                                          ▼
   ( žádný řádek ) ──subscribe (double)──> [pending] ──confirm──> [confirmed]
        ▲                                     │  ▲                  │   │
        │                                     │  │ subscribe        │   │
        │      cleanup po 30 dnech            │  └──────────────────┘   │
        └─────────────────────────────────────┘                         │
                                              │                         │
                             unsubscribe      │      unsubscribe        │
                                              ▼                         ▼
                                       [unsubscribed] <────────────────┘
                                              │
                             subscribe (vždy přes pending)
                                              │
                                              ▼
                                         [pending]

   [confirmed] ──hard bounce──> [bounced]        (suppression: hard_bounce)
   [confirmed] ──complaint────> [complained]     (suppression: complaint, odhlášení ze všech seznamů)
   [bounced]   ──subscribe────> [pending]        jen když je suppression odebratelná
   [complained]──subscribe────> ODMÍTNUTO        jen ruční zásah správce se záznamem v auditu
```

Úplná tabulka přechodů:

| Z | Událost | Do | Vedlejší efekty |
|---|---|---|---|
| žádný | `subscribe`, `opt_in = single` | `confirmed` | souhlas `granted`, uvítací e-mail (pokud zapnutý), událost `contact.subscribed` |
| žádný | `subscribe`, `opt_in = double` | `pending` | token, potvrzovací e-mail, `confirmation_sent_at` |
| `pending` | `confirm` s platným tokenem | `confirmed` | token spotřebován, souhlas `granted` s důkazem, uvítací e-mail, `contact.status` z `unconfirmed` na `active` |
| `pending` | `confirm` s prošlým tokenem | `pending` | vydá se nový token a odešle nový e-mail, pokud `confirmation_resends < confirmation_max_resends`; uživatel vidí „odkaz vypršel, poslali jsme nový" |
| `pending` | `confirm` se spotřebovaným tokenem | `confirmed` (beze změny) | zobrazí se „už jste potvrzeno", nic se nemění; **nikdy chyba**, protože lidé klikají dvakrát |
| `pending` | `subscribe` znovu | `pending` | resend, limity: min 5 minut mezi e-maily, max `confirmation_max_resends` za 24 h |
| `pending` | TTL vypršelo + retence 30 dní | řádek smazán | žádný souhlas nevznikl |
| `pending` | `unsubscribe` | `unsubscribed` | |
| `confirmed` | `unsubscribe` (jakýkoliv kanál) | `unsubscribed` | souhlas `withdrawn` (scoped na seznam), zrušení čekajících zpráv, událost `contact.unsubscribed` |
| `confirmed` | hard bounce (část 4) | `bounced` | `suppressions(hard_bounce)`, `contacts.status = 'bounced'` |
| `confirmed` | complaint (část 4) | `complained` | `suppressions(complaint)`, **všechny** seznamy na `unsubscribed`, `contacts.status = 'complained'`, souhlas `withdrawn` globálně |
| `unsubscribed` | `subscribe`, `opt_in = single` | **`pending`** | vynucené double opt-in i na single seznamu |
| `unsubscribed` | `subscribe`, `opt_in = double` | `pending` | |
| `unsubscribed` | `confirm` | `confirmed` | odstraní se suppression s důvodem `global_unsubscribe` nebo `one_click_unsubscribe`, nový souhlas |
| `bounced` | `subscribe` | `pending` nebo odmítnutí | povoleno jen když je suppression odebraná nebo starší 30 dní; jinak `subscribe_blocked_suppressed` |
| `complained` | `subscribe` | **odmítnutí** | `subscribe_blocked_complaint`, jediná cesta je ruční zásah správce |

Zakázané přechody: `confirmed → pending` (nikdy se potichu nedegraduje), `complained → confirmed` bez zásahu správce, jakýkoliv přechod do `confirmed` z importu na double opt-in seznamu bez `consent.declaration`.

Pravidlo „odhlášený se vždy vrací přes `pending`" je klíčové: bez něj by stačilo znovu naimportovat starý soubor a odhlášení lidé by byli zpátky v rozesílce.

#### 4.8.2 Potvrzovací token

- 32 náhodných bajtů z CSPRNG, base64url bez paddingu, 43 znaků.
- V databázi jen `sha256(token)` v `subscription_confirmations.token_hash`. Syrový token existuje jen v odeslaném e-mailu.
- Platnost `lists.confirmation_ttl_hours`, výchozí 168 hodin (7 dní), rozsah 1 až 720.
- Jednorázový (`consumed_at`).
- URL `{APP_URL}/s/c/{token}`.
- Nové přihlášení stejného kontaktu do stejného seznamu **zneplatní** předchozí nespotřebované tokeny (`UPDATE ... SET consumed_at = now(), ...` s příznakem `superseded`). Jinak by v e-mailové schránce zůstalo víc funkčních odkazů.

#### 4.8.3 Jednokrokové versus dvoukrokové potvrzení

`lists.confirmation_mode`:

- **`two_step` (výchozí).** `GET /s/c/{token}` vykreslí stránku s jedním velkým tlačítkem, `POST /s/c/{token}` teprve potvrdí. Antispamové skenery a náhledové služby, které v e-mailech automaticky otevírají odkazy, tím nemohou nikoho přihlásit. Cena je jedno kliknutí navíc.
- **`one_step`.** `GET /s/c/{token}` potvrdí rovnou. Vyšší konverze, ale potvrzení může vzniknout bez vědomí člověka, což snižuje jeho právní hodnotu jako důkazu.

UI u přepínače ukazuje tenhle rozdíl doslova. Odhad dopadu na míru potvrzení je 5 až 15 procent a je uvedený jako odhad, ne jako fakt.

#### 4.8.4 Chování veřejných stránek

| Situace | HTTP | Co uvidí návštěvník |
|---|---|---|
| Platný token, dvoukrokový režim, GET | 200 | „Potvrďte prosím přihlášení k odběru *Newsletter*." + tlačítko |
| Platný token, POST | 200 | „Hotovo, jste přihlášeni." + odkaz na preference |
| Platný token, jednokrokový, GET | 200 | „Hotovo, jste přihlášeni." |
| Prošlý token | 200 | „Odkaz už vypršel. Poslali jsme vám nový." + tlačítko „poslat znovu" |
| Spotřebovaný token | 200 | „Tenhle odkaz už byl použit. Jste přihlášeni." |
| Neplatný nebo poškozený token | 200 | „Tenhle odkaz neplatí." Stejná stránka jako u neexistujícího tokenu, aby nešlo zjišťovat existenci kontaktů |
| Kontakt mezitím na suppression listu s `complaint` | 200 | „Tenhle odkaz neplatí." |

Návratový kód je vždy 200, nikdy 404, právě kvůli enumeraci. Rate limit 30 požadavků za minutu na IP.

Anglické texty: „Please confirm your subscription to *Newsletter*.", „Done, you are subscribed.", „This link has expired. We have sent you a new one.", „This link has already been used. You are subscribed.", „This link is not valid."

### 4.9 Odhlášení a stránka s preferencemi

#### 4.9.1 One-click podle RFC 8058

Ověřeno proti textu RFC 8058 (Standards Track, leden 2017) dne 2026-07-31. Závazné body, které z něj plynou:

1. Zpráva nese **obě** hlavičky:
   ```
   List-Unsubscribe: <https://marketing.example.com/u/AbC123...>, <mailto:unsubscribe@example.com?subject=unsub-AbC123>
   List-Unsubscribe-Post: List-Unsubscribe=One-Click
   ```
   `List-Unsubscribe` **musí** obsahovat právě jedno HTTPS URI a smí obsahovat další ne-HTTP URI. `List-Unsubscribe-Post` **musí** obsahovat přesně dvojici `List-Unsubscribe=One-Click`.
2. Zpráva **musí mít platný DKIM podpis, který pokrývá obě tyto hlavičky.** Bez toho je one-click neplatný. Tohle je požadavek na část 4, viz 11.3.
3. URI **musí** samo o sobě nést dost informací k identifikaci příjemce a seznamu, protože POST nepřenáší žádné další argumenty.
4. URI **má** obsahovat neuhodnutelnou složku, kterou server ověří. Tím se brání útoku, kdy někdo rozešle spam s odkazy na cizí seznam, aby ho uživatelské stížnosti odhlásily.
5. POST **nesmí** obsahovat cookies, HTTP autorizaci ani jiný kontext.
6. Server **nesmí** na POST vrátit přesměrování, protože přesměrovaný POST se v prohlížečích historicky chová nespolehlivě a často se mění na GET.

Naše implementace:

| Metoda | Cesta | Chování |
|---|---|---|
| `GET` | `/u/{token}` | vykreslí stránku s preferencemi, **nic neodhlásí** |
| `POST` | `/u/{token}` s tělem `List-Unsubscribe=One-Click` | okamžitě odhlásí, vrátí `200` s krátkým HTML, bez přesměrování |
| `POST` | `/u/{token}` s jiným tělem z formuláře na stránce preferencí | provede zvolenou akci, vrátí `303` na stránku s potvrzením (tohle je běžný formulář, ne one-click, takže se ho zákaz přesměrování netýká) |

**`POST /u/{token}` je vyňatý z per-IP rate limitu.** Tenhle POST neposílá prohlížeč příjemce, ale infrastruktura poštovního providera: Gmail, Apple Mail a Outlook ho volají ze své vlastní, poměrně úzké sady serverových IP adres. U kampaně na sto tisíc adres přijdou stovky odhlášení za minutu z několika málo IP. Per-IP limit 30 za minutu by je začal odmítat s `429`, poštovní klient by uživateli ukázal, že odhlášení selhalo, a ten by místo toho označil zprávu jako spam. Neúspěšné one-click odhlášení je přesně to, za co Gmail penalizuje doručitelnost, takže by ochrana způsobila právě tu škodu, které má bránit.

Limit se proto aplikuje **jen per token** (20 za hodinu, což pokryje i dvojklik a opakované doručení), a globální ochrana endpointu je na úrovni celé instalace, ne jednotlivé IP. Token sám o sobě je neuhodnutelný, takže per-IP limit stejně nechrání proti ničemu smysluplnému.

Endpoint `POST /u/{token}` je zároveň **vědomě vyňatý z CSRF ochrany**. Autorizaci nese samotný podepsaný token, cookie se nečte. Je to přímý požadavek RFC 8058 bodu 5 a musí to být v kódu okomentované, jinak to při příští bezpečnostní revizi někdo „opraví".

Přijímané typy těla: `application/x-www-form-urlencoded` a `multipart/form-data`. RFC uvádí obě.

#### 4.9.2 Rozsah odhlášení

| Situace | Efekt |
|---|---|
| Token nese `list_id` (běžná kampaň na seznam) | odhlášení **z toho seznamu**: `list_subscriptions.status = 'unsubscribed'`, souhlas `withdrawn` se `scope_list_id`. **Nezapisuje se suppression**, protože suppression platí pro celý projekt |
| Token nese `list_id`, ale kontakt je jen v tomhle jednom seznamu | totéž; UI na stránce preferencí ale nabídne i „odhlásit ze všeho" |
| Token nenese `list_id` (transakční, nebo kampaň na segment bez seznamu) | **globální odhlášení**: `suppressions(global_unsubscribe)`, `contacts.status = 'unsubscribed'`, všechny seznamy na `unsubscribed`, souhlas `withdrawn` bez rozsahu |
| One-click z poštovního klienta | chová se podle výše; navíc `unsubscribe_reason = 'one_click'` |
| „Odhlásit ze všeho" na stránce preferencí | globální odhlášení, `unsubscribe_reason = 'preference_center'` |
| „Pozastavit na 30/60/90 dní" | `snooze_until = now() + N dní`, stav zůstává `confirmed` |

Rozdíl mezi odhlášením ze seznamu a globálním je nejčastější zdroj nedorozumění, proto je na stránce preferencí napsaný doslova: „Odhlašujete se ze seznamu *Newsletter*. Ostatní e-maily od nás vám budou chodit dál." s tlačítkem „Nechci od vás už nic".

#### 4.9.3 Payload tokenu

Formát a podpis vlastní část 5 (viz 11.4). Tato část definuje obsah a platnost:

```ts
type UnsubscribeTokenPayload = {
  v: 1;
  k: 'u';                    // kind: 'u' = unsubscribe, 'p' = preference center
  w: string;                 // workspace_id
  c: string;                 // contact_id
  m?: string;                // message_id, kvůli atribuci odhlášení ke kampani
  ca?: string;               // campaign_id
  l?: string;                // list_id, chybí = globální rozsah
  exp: 0;                    // bez expirace
};
```

`exp: 0` znamená **bez expirace**. Odhlašovací odkaz musí fungovat i za pět let, jinak člověk, který si e-mail nechal ve schránce, nemá jak souhlas odvolat, a to je jak porušení čl. 7 odst. 3 GDPR, tak přímá cesta ke stížnosti na spam.

Z toho plyne tvrdý požadavek na část 1: **rotace `SECRET_KEY` nesmí zneplatnit odhlašovací tokeny.** Musí existovat `SECRET_KEY_PREVIOUS` (nebo seznam verzí klíčů), který se používá jen k ověřování, a odhlašovací tokeny nesou verzi klíče v prefixu.

#### 4.9.4 Dopad na běžící kampaň

Publikum se materializuje v okamžiku odeslání (část 4), takže odhlášení po materializaci by jinak nemělo efekt. Mechanismus:

Tabulku `messages` **nevlastní tato část** a nesmí do ní zapisovat napřímo (viz Rozsah v sekci 1). Odhlašovací handler proto ve **stejné transakci** jako změnu stavu volá funkci části 4:

```ts
// vlastní část 4, konzumuje tato část
export function revokePendingMessages(ctx: WorkspaceContext, input: {
  contactId: string;
  listId: string | null;        // null = všechny kampaně, jinak jen kampaně mířené na tento seznam
  reason: 'unsubscribed' | 'suppressed' | 'contact_deleted' | 'contact_anonymized'
        | 'processing_restricted';
}): Promise<{ revoked: number }>;
```

**Parametr `listId` je nutný a dnes v části 4 chybí.** Bez něj by odhlášení z jednoho newsletteru zrušilo **veškerou** čekající poštu toho člověka, včetně kampaní na jiné seznamy a transakčních zpráv. To je tichá ztráta pošty, kterou by nikdo nedohledal, protože zpráva prostě neodejde a nikde nevznikne chyba.

Funkce smí provést **výhradně přechod `pending → skipped`** a zapsat do `error_code` (kontraktní sloupec, ne `error`) hodnotu odpovídající `reason`. Řádky ve stavu `claimed` nechává být, protože je právě zpracovává sender a přepis stavu pod ním by způsobil buď duplicitu, nebo ztracenou zprávu.

Tato část ji volá na **pěti místech**:

| Místo | `listId` | `reason` |
|---|---|---|
| Odhlášení ze seznamu (4.9.2) | konkrétní seznam | `unsubscribed` |
| Globální odhlášení a námitka podle čl. 21 | `null` | `unsubscribed` |
| `suppressions.add` (4.10.4) | `null` | `suppressed` |
| Měkké i tvrdé smazání kontaktu (4.1.5) | `null` | `contact_deleted` |
| Anonymizace podle čl. 17 (4.14.4) | `null` | `contact_anonymized` |
| Nastavení `processing_restricted = true` (čl. 18) | `null` | `processing_restricted` |

Praktický důsledek, který je potřeba říct nahlas: **v nejhorším případě může jednomu odhlášenému člověku ještě odejít jedna zpráva**, a to v okně mezi vyzvednutím dávky senderem a jejím odesláním. Při dávce 500 a běžné propustnosti je to okno v řádu sekund až desítek sekund. Zkrátit ho na nulu by znamenalo, že sender čte tabulku kontaktů, což hlavní specifikace zakazuje, a bylo by to výrazně horší.

Totéž platí pro zápis do suppression listu z libovolného důvodu.

#### 4.9.5 Stránka s preferencemi

`GET /p/{token}`, token typu `k: 'p'`, bez expirace, bez přihlášení.

Obsah:

| Blok | Popis |
|---|---|
| Identita | „Nastavení pro j***@example.cz" (adresa částečně maskovaná, aby náhodný nálezce odkazu neviděl celou adresu) |
| Seznamy | zaškrtávátka se stavem, popis seznamu, datum přihlášení |
| Frekvence | „Posílat méně často": pozastavit na 30 / 60 / 90 dní |
| Jazyk | výběr jazyka komunikace, zapisuje do `contacts.locale` |
| Údaje | pole s `subject_editable = true`, plus jméno a příjmení (čl. 16 GDPR, oprava) |
| Odhlásit ze všeho | výrazné tlačítko, potvrzovací dialog |
| Moje data | „Stáhnout kopii mých údajů" (čl. 15 a 20) a „Smazat mé údaje" (čl. 17), obojí založí `gdpr_requests` |

Vše funguje bez JavaScriptu, formuláře jsou `POST` se `303` přesměrováním. Rate limit 20 požadavků za minutu na IP a 60 za hodinu na token.

Neplatný token vede na stejnou generickou stránku s hláškou „Tenhle odkaz neplatí. Odkaz najdete v patičce kteréhokoliv našeho e-mailu." Nikdy se neprozradí, jestli kontakt existuje.

### 4.10 Suppression list

#### 4.10.1 Co ho plní

| Důvod | Zdroj | Kdo zapisuje | `removable` |
|---|---|---|---|
| `hard_bounce` | trvalé odmítnutí od providera | část 4 | false |
| `soft_bounce_threshold` | práh **vlastní část 4a** (3 měkké odrazy ve 30 dnech); tato část hodnotu nedefinuje a nekopíruje | část 4 | true |
| `complaint` | stížnost na spam (SES feedback loop) | část 4 | **false, natrvalo** |
| `global_unsubscribe` | odhlášení bez rozsahu seznamu | část 2 | false |
| `one_click_unsubscribe` | RFC 8058 POST bez `list_id` | část 2 | false |
| `manual` | ruční přidání v UI nebo API | část 2 | true |
| `import` | import souboru se zakázanými adresami | část 2 | true |
| `invalid` | syntakticky neplatná adresa zachycená při odesílání | část 4 | true |
| `gdpr_erasure` | výmaz podle čl. 17 | část 2 | **false, natrvalo** |

#### 4.10.2 Odebrání

| Důvod | Kdo smí odebrat | Podmínky |
|---|---|---|
| `complaint` | nikdo | Není žádná cesta v UI ani v API. Jediná možnost je zásah v databázi, který si musí provozovatel obhájit sám. Stížnost je nejsilnější negativní signál, jaký od příjemce existuje, a hromadné odblokování stížností je nejrychlejší cesta k pozastavení SES účtu |
| `gdpr_erasure` | nikdo | Je to poslední stopa po smazaném člověku a zároveň jediná ochrana proti jeho vzkříšení importem |
| `hard_bounce` | owner nebo admin | Jen po 30 dnech od vzniku, jen po jedné adrese, s potvrzovacím dialogem a zápisem do auditu. Hromadné odebrání tvrdých odrazů není v UI dostupné |
| `soft_bounce_threshold`, `manual`, `import`, `invalid` | owner, admin, editor | Kdykoliv, i hromadně |
| `global_unsubscribe`, `one_click_unsubscribe` | nikdo přímo | Odstraní se **automaticky**, když ten samý člověk projde znovu double opt-in. Tím je návrat vždy jeho rozhodnutím, ne rozhodnutím marketéra |

Odebrání je měkké: `removed_at`, `removed_by`, `removal_note`. Řádek zůstává jako důkaz.

#### 4.10.3 Kde se kontroluje

Kontrola je jeden dotaz, který musí být rychlý, protože běží u každého importovaného řádku, každého přihlášení a při materializaci publika:

```sql
SELECT reason FROM suppressions
 WHERE workspace_id = $1
   AND removed_at IS NULL
   AND (email = $2 OR email_hash = $3)
 LIMIT 1;
```

Dvě větve `OR` pokrývají dva indexy z 3.5. Druhá větev existuje kvůli adresám vymazaným podle GDPR, u kterých už plaintext nemáme.

**Obě podmínky jsou povinné v každé kontrole, bez výjimky:**

1. **`removed_at IS NULL`.** Bez ní by adresa legitimně odblokovaná po 30 dnech podle matice 4.10.2 zůstala vyloučená navždy, protože měkce odebraný řádek v tabulce zůstává. Odblokování by tím bylo tiše bez efektu a nikdo by nepoznal proč.
2. **Větev přes `email_hash`.** Bez ní by šlo znovu naimportovat člověka, který uplatnil právo na výmaz, protože jeho plaintextovou adresu už neznáme.

Kontrola s jednou z nich chybějící je chyba, ne optimalizace. Platí to pro materializaci publika (část 4), import, přihlášení do seznamu, odeslání formuláře i příchozí webhook. Jediné povolené místo, kde se kontrola píše, je repository funkce `suppressions.check(ctx, emails)`, aby nešlo napsat sedmou variantu.

Při importu se kontrola dělá dávkově, ne po řádcích:

```sql
SELECT s.email, s.email_hash, s.reason
  FROM suppressions s
 WHERE s.workspace_id = $1 AND s.removed_at IS NULL
   AND (s.email = ANY($2::citext[]) OR s.email_hash = ANY($3::bytea[]));
```

#### 4.10.4 `suppressions.add`: jediná cesta, jak něco zablokovat

Doména, ne jen tabulka. Zápis do `suppressions` napřímo je zakázaný, protože kolem něj visí pět dalších efektů, na které se jinak zapomene.

```ts
// packages/db/src/repo/suppressions.ts
export function add(ctx: WorkspaceContext, input: {
  email: string;
  reason: 'hard_bounce' | 'soft_bounce_threshold' | 'complaint' | 'manual'
        | 'global_unsubscribe' | 'one_click_unsubscribe' | 'invalid'
        | 'import' | 'gdpr_erasure' | 'ses_suppressed';
  source: string;
  sourceRef?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;              // výchozí now(); část 4 dodá čas události od providera
}): Promise<{ suppressionId: string; created: boolean; contactId: string | null }>;
```

**Co funkce udělá, celé v jedné transakci:**

1. Normalizuje e-mail podle 4.1.1 a **spočítá `email_hash` sama** (HMAC-SHA256 se `SUPPRESSION_HASH_KEY`). Volající hash nikdy nepočítá ani nepředává, jinak by se dvě implementace rozešly.
2. Vloží řádek idempotentně:

   ```sql
   INSERT INTO suppressions (id, workspace_id, email, email_hash, reason, source,
                             source_ref, detail, metadata, removable, created_at, created_by)
   VALUES (...)
   ON CONFLICT (workspace_id, email) WHERE removed_at IS NULL
   DO UPDATE SET metadata = suppressions.metadata || excluded.metadata,
                 detail   = coalesce(excluded.detail, suppressions.detail)
   RETURNING id, (xmax = 0) AS created;
   ```

   Klauzule `WHERE removed_at IS NULL` za `ON CONFLICT` je **inference částečného indexu** `uq_suppressions__workspace_email`. Bez ní příkaz skončí chybou 42P10. Je to přesně ta past, kterou popisuju u kontaktů ve 4.1.7, a platí i tady.

   Existující řádek se **nepřepisuje jiným důvodem**. Když je adresa už blokovaná kvůli `complaint` a přijde `hard_bounce`, důvod zůstane `complaint`, protože je přísnější, a nový podnět se přidá do `metadata.occurrences`. Priorita důvodů odshora: `gdpr_erasure`, `complaint`, `hard_bounce`, `ses_suppressed`, `global_unsubscribe`, `one_click_unsubscribe`, `soft_bounce_threshold`, `invalid`, `import`, `manual`.
3. Nastaví `removable` podle matice v 4.10.1. Volající ho nepředává.
4. Dohledá kontakt podle e-mailu v tomtéž projektu (může být `null`, suppression může existovat i bez kontaktu, typicky u importu blokovaných adres).
5. **Provede doménové efekty podle matice 4.8.1**, pokud kontakt existuje:

   | `reason` | `list_subscriptions` | `contacts.status` | `consents` |
   |---|---|---|---|
   | `complaint` | **všechny** řádky na `complained` | `complained` | `withdrawn` pro `email_marketing`, bez rozsahu, `source = 'complaint'` |
   | `hard_bounce`, `ses_suppressed` | všechny `confirmed` a `pending` na `bounced` | `bounced` | beze změny (odraz není projev vůle) |
   | `soft_bounce_threshold` | beze změny | `bounced` | beze změny |
   | `global_unsubscribe`, `one_click_unsubscribe` | všechny na `unsubscribed` | `unsubscribed` | `withdrawn` pro `email_marketing`, bez rozsahu |
   | `gdpr_erasure` | řádky se mažou (viz 4.14.4) | `deleted` | mažou se |
   | `invalid` | beze změny | `bounced` | beze změny |
   | `manual`, `import` | beze změny | beze změny | beze změny |

   Tohle je ta část, kvůli které funkce existuje. Bez ní zůstane `contacts.status` na `active` a odporuje to tvrzení ze 4.1.6, že status je odvozený údaj udržovaný v téže transakci.
6. Zavolá `revokePendingMessages(ctx, { contactId, listId: null, reason: 'suppressed' })` z části 4 (viz 4.9.4), aby se zrušily čekající zprávy.
7. Zapíše `audit_log` akci `suppression.added` a vyvolá odchozí událost `contact.suppressed`.

**Idempotence.** Opakované volání se stejnými vstupy nic nezmění a vrátí `created: false` s původním `suppressionId`. Je to nutnost, protože SNS doručuje události nejméně jednou (část 4) a tentýž bounce může dorazit třikrát.

**Kdo funkci volá:** část 4 při bounci, stížnosti a `OnAccountSuppressionList`; tato část při globálním odhlášení, one-click odhlášení, ručním přidání, importu blokovaných adres a GDPR výmazu. **Žádná část nesmí do `suppressions` zapisovat jinak.**

#### 4.10.5 Chování při importu adresy na listu

Rozhodnuto ve 4.1.2 bodu 4 a opakuje se tady, protože je to častý dotaz:

| Důvod suppression | Kontakt se založí nebo aktualizuje | Přihlášení do seznamu | Souhlas | Počítá se jako |
|---|---|---|---|---|
| `complaint` | **ne** | ne | ne | `suppressed_rows` |
| `gdpr_erasure` | **ne** | ne | ne | `suppressed_rows` |
| ostatní | ano | ne | ne | `suppressed_rows` |

Import ani API nikdy suppression sám neodstraní.

### 4.11 Segmentační engine

#### 4.11.1 JSON schéma AST

Verze 1. Uloženo v `segments.definition`, validováno Zod schématem `SegmentAstV1` a zároveň publikováno jako JSON Schema pro OpenAPI.

```jsonc
{
  "version": 1,
  "root": {
    "type": "group",
    "op": "and",
    "not": false,
    "children": [
      { "type": "condition", "field": { "kind": "contact", "key": "status" },
        "operator": "eq", "value": "active" },
      { "type": "condition", "field": { "kind": "attribute", "key": "city" },
        "operator": "in", "values": ["Praha", "Brno"] },
      { "type": "group", "op": "or", "children": [
        { "type": "condition", "field": { "kind": "tag" },
          "operator": "has_any", "values": ["<tag-uuid-1>", "<tag-uuid-2>"] },
        { "type": "condition", "field": { "kind": "engagement", "metric": "opened",
            "scope": { "since_days": 90 } },
          "operator": "did" }
      ]}
    ]
  }
}
```

Typy v TypeScriptu:

```ts
type SegmentAst = { version: 1; root: GroupNode };

type Node = GroupNode | ConditionNode;

type GroupNode = {
  type: 'group';
  op: 'and' | 'or';
  not?: boolean;
  children: Node[];          // 1..50
};

type ConditionNode = {
  type: 'condition';
  field: FieldRef;
  operator: Operator;
  value?: ScalarValue;       // pro jednohodnotové operátory
  values?: ScalarValue[];    // pro in / not_in / has_* / between
};

type ScalarValue = string | number | boolean | null;

type FieldRef =
  | { kind: 'contact'; key: ContactFieldKey }
  | { kind: 'attribute'; key: string }
  | { kind: 'tag' }
  | { kind: 'list'; list_id: string }
  | { kind: 'consent'; purpose: ConsentPurpose }
  | { kind: 'suppression' }
  | { kind: 'engagement'; metric: EngagementMetric; scope: EngagementScope }
  | { kind: 'event'; name: string; property?: string }
  | { kind: 'segment'; segment_id: string };

type ContactFieldKey =
  | 'email' | 'email_domain' | 'first_name' | 'last_name' | 'gender' | 'status'
  | 'locale' | 'source' | 'created_at' | 'updated_at' | 'last_activity_at'
  | 'vocative_confidence' | 'processing_restricted';

type EngagementMetric = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced';

type EngagementScope = {
  campaign_id?: string;        // konkrétní kampaň
  since_days?: number;         // 1..730
  last_n_campaigns?: number;   // 1..50
};

type ConsentPurpose = 'email_marketing' | 'analytics' | 'personalization' | 'profiling' | 'third_party';
```

#### 4.11.2 Operátory a typová kompatibilita

| Třída pole | Povolené operátory |
|---|---|
| `text`, `long_text`, `url`, `email`, `phone`, `email_domain` | `eq`, `neq`, `contains`, `not_contains`, `starts_with`, `ends_with`, `in`, `not_in`, `is_empty`, `is_not_empty` |
| `number` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `is_empty`, `is_not_empty` |
| `boolean` | `is_true`, `is_false`, `is_empty` |
| `date`, `datetime` | `on`, `before`, `after`, `between`, `in_last_days`, `not_in_last_days`, `in_next_days`, `is_empty`, `is_not_empty` |
| `enum` | `eq`, `neq`, `in`, `not_in`, `is_empty`, `is_not_empty` |
| `multi_enum` | `has_any`, `has_all`, `has_none`, `is_empty`, `is_not_empty` |
| `tag` | `has_any`, `has_all`, `has_none` |
| `list` | `is_member`, `is_not_member`, `is_confirmed`, `is_pending`, `is_unsubscribed` |
| `consent` | `is_granted`, `is_withdrawn`, `is_missing` |
| `suppression` | `is_suppressed`, `is_not_suppressed` |
| `engagement` | `did`, `did_not`, `count_gte`, `count_lte` |
| `event` | `did`, `did_not`, `count_gte`, `count_lte` |
| `segment` | `in`, `not_in` |

Typová kompatibilita hodnot:

| Operátor | Očekává | Validace |
|---|---|---|
| `eq`, `neq`, `contains`, ... | `value` typu odpovídajícího poli | `text` → string, `number` → number, `boolean` → boolean |
| `in`, `not_in`, `has_any`, `has_all`, `has_none` | `values`, 1 až 1 000 položek | všechny stejného typu |
| `between` | `values` právě 2 položky | `values[0] <= values[1]`, jinak `segment_invalid_range` |
| `in_last_days`, `not_in_last_days`, `in_next_days` | `value` celé číslo 1 až 3 650 | |
| `is_empty`, `is_not_empty`, `is_true`, `is_false`, `did`, `did_not`, `is_suppressed`, ... | žádná hodnota | přítomnost `value` nebo `values` je chyba |
| `count_gte`, `count_lte` | `value` celé číslo 0 až 1 000 000 | |

Kombinace pole a operátoru mimo tabulku vede na `segment_operator_not_allowed` s uvedením, které operátory jsou pro dané pole povolené.

Pole typu `date` versus `datetime`: operátory `on`, `before`, `after` u `datetime` porovnávají celý den v časové zóně projektu, ne půlnoc UTC. Bez tohohle pravidla by segment „registrovali se 31. 7." vynechal půlku dne.

#### 4.11.3 Kompilace do SQL bez rizika injection

**Kde kompilátor žije.** Část 1 v 3.6 zakazuje přímý import `db` mimo `packages/db` a vyžaduje, aby datový přístup šel přes repository funkce s branded `WorkspaceContext`. Kompilátor segmentů generuje dynamické SQL, takže **žije uvnitř repository vrstvy** jako `packages/db/src/repo/segments.ts`. Čistá část (parser, validátor AST, typová matice) zůstává v `packages/core/segments` a nezná databázi. Rozhraní směrem ven je jediná funkce:

```ts
// packages/db/src/repo/segments.ts

/** Hotový výsledek pro UI. Obojí volá compileAudienceToSql pod sebou. */
export function countSegment(ctx: WorkspaceContext, ast: SegmentAst,
                             opts?: { timeoutMs?: number; asOf?: Date }): Promise<SegmentCountResult>;
export function listSegmentContacts(ctx: WorkspaceContext, ast: SegmentAst,
                             page: CursorPage, opts?: { asOf?: Date }): Promise<Page<ContactRow>>;

/**
 * Kompilace publika pro materializaci kampaně (část 4). Vrací SQL a parametry,
 * volající si je vloží do vlastního dávkového průchodu.
 */
export function compileAudienceToSql(
  ctx: WorkspaceContext,
  audience: { segmentIds?: string[]; listIds?: string[]; ast?: SegmentAst },
  opts: { alias: string; paramOffset: number; asOf: Date },
): Promise<{ sql: string; params: unknown[] }>;
```

**Kontrakt `compileAudienceToSql`.** Toto je jediná podporovaná cesta, jak sestavit publikum. Část 4 nesmí psát vlastní SQL nad `contacts`, `list_subscriptions` ani `suppressions`.

| Vlastnost | Hodnota |
|---|---|
| Návratové `sql` | `SELECT <alias>.id AS contact_id FROM contacts <alias> WHERE ...` |
| Co v něm **není** | `ORDER BY`, `LIMIT`, `OFFSET`, středník. Řazení a stránkování si dělá volající |
| `alias` | Povinný, validovaný proti `^[a-z][a-z0-9_]{0,9}$`. Kompilátor ho použije všude místo natvrdo zadrátovaného `c` |
| `paramOffset` | Parametry se číslují od `paramOffset + 1`. Volající tak může mít vlastní `$1` až `$n` před naším blokem |
| `params` | Pole hodnot v pořadí odpovídajícím číslování. První je vždy `workspace_id`, druhý vždy `asOf` |
| `asOf` | **Povinný.** Viz odstavec o vyhodnocení času níže |
| Asynchronní | Kvůli ověření příslušnosti `segmentIds`, `listIds` a všech referencí uvnitř AST k projektu (vrstva 3 níže) |
| `segmentIds` a `listIds` zároveň | Sjednocení (`OR`), tedy „kdo je v kterémkoliv z těchto seznamů nebo segmentů". Odpovídá tomu, jak se publikum skládá v UI |
| Prázdné `audience` | Chyba `422 validation_failed` s `audience_empty`, nikdy „všichni kontakty" |

**Obálka, kterou kompilátor přidává vždy a volající ji nemůže vynechat:**

```sql
SELECT a.id AS contact_id
  FROM contacts a
 WHERE a.workspace_id = $1                    -- z ctx, nikdy z argumentu
   AND a.deleted_at IS NULL                   -- měkce smazaný kontakt není příjemce
   AND a.processing_restricted = false        -- GDPR čl. 18
   AND NOT EXISTS (                           -- suppression, obě větve, jen neodebrané
         SELECT 1 FROM suppressions su
          WHERE su.workspace_id = a.workspace_id
            AND su.removed_at IS NULL
            AND (su.email = a.email OR su.email_hash = a.email_hash))
   AND (<zkompilované publikum>)
```

Členství v seznamu se kompiluje takto, včetně pozastavení odběru:

```sql
EXISTS (SELECT 1 FROM list_subscriptions ls
         WHERE ls.contact_id = a.id
           AND ls.list_id = ANY($n::uuid[])
           AND ls.status = 'confirmed'                       -- nikdy 'pending'
           AND (ls.snooze_until IS NULL OR ls.snooze_until <= $2))   -- $2 = asOf
```

Tři podmínky v obálce (`deleted_at`, `processing_restricted`, suppression) a dvě u seznamu (`confirmed`, `snooze_until`) jsou **doménové požadavky části 2**, ne optimalizace. Kdyby chyběly, odešla by pošta člověku s omezeným zpracováním podle čl. 18, člověku, který si dal pauzu, a člověku, který ještě nepotvrdil přihlášení. Právě proto je kompilace uvnitř této části a ne v ručně psaném SQL části 4.

Modul se registruje do `isolation.matrix.test.ts` části 1, takže generický test cizího kontextu ho pokrývá automaticky.

Základní tvrzení: **žádná část uživatelského vstupu se nikdy nedostane do textu SQL.** Zajišťují to tři nezávislé vrstvy, plus RLS jako čtvrtá, nezávisle na nich.

**Vrstva 1: validace tvaru.** AST projde Zod schématem. Všechny diskriminátory (`kind`, `operator`, `op`, `key` u `contact`) jsou uzavřené výčty. Neznámá hodnota končí `422 validation_failed` s `segment_invalid_ast` ještě před dotykem s databází.

**Vrstva 2: rozlišení identifikátorů.** Sloupce prvotřídních polí se překládají přes **konstantní mapu v kódu**, ne konkatenací:

```ts
const CONTACT_COLUMN_SQL: Record<ContactFieldKey, string> = {
  email:            'c.email::text',
  email_domain:     'c.email_domain',
  first_name:       'c.first_name',
  last_name:        'c.last_name',
  gender:           'c.gender',
  status:           'c.status',
  locale:           'c.locale',
  source:           'c.source',
  created_at:       'c.created_at',
  updated_at:       'c.updated_at',
  last_activity_at: 'c.last_activity_at',
  vocative_confidence: 'c.vocative_confidence',
  processing_restricted: 'c.processing_restricted',
};
```

Klíč, který v mapě není, nemůže vyrobit SQL. Klíč vlastního pole se **nikdy neinterpoluje**, jde dovnitř jako parametr:

```sql
-- ŠPATNĚ (nikdy takhle):   c.attributes ->> 'city'
-- SPRÁVNĚ:                 c.attributes ->> $3        s $3 = 'city'
```

Stejně tak `list_id`, `tag_id`, `campaign_id` a `segment_id` jsou vždy parametry typu `uuid`, nikdy text v dotazu.

**Vrstva 3: kontrola příslušnosti k projektu.** Před kompilací se pro daný projekt ověří, že každé `attribute.key` existuje v `contact_fields`, každé `list_id` v `lists`, každé `tag_id` v `tags` a každé `segment_id` v `segments`. Neexistující nebo cizí ID vede na `404 not_found` s `segment_reference_not_found`. **Tohle je ta skutečná bezpečnostní hranice**, protože reálné riziko není podstrčené SQL, ale odkaz na cizí projekt. Jsou na to samostatné testy.

Kompilátor navíc **vždy** připojí obálku, kterou volající nemůže vynechat:

```sql
SELECT c.id
  FROM contacts c
 WHERE c.workspace_id = $1
   AND c.deleted_at IS NULL
   AND c.processing_restricted = false
   AND (<zkompilovaný predikát>)
```

`processing_restricted = false` je tam kvůli čl. 18 GDPR: kontakt s omezeným zpracováním nesmí spadnout do žádného segmentu, aniž by ho musel autor segmentu vylučovat ručně.

**Vrstva 4: row-level security.** Podle 3.6 části 1 má `contacts` zapnuté RLS s politikou `ws_isolation` a repository vrstva na začátku transakce volá `set_config('openengage.workspace_id', ...)`. Pro kompilátor segmentů je to nejcennější pojistka v celém dokumentu: i kdyby v něm byla chyba, která `workspace_id = $1` z obálky vynechá, RLS vrátí **nula řádků**, ne cizí data. Proto se dynamické SQL nikdy nespouští mimo transakci s nastaveným kontextem, a je na to samostatný test „surové SQL bez `set_config` vrátí 0 řádků" (převzatý ze sady části 1).

Ukázky kompilace jednotlivých uzlů:

| Uzel | Vygenerované SQL |
|---|---|
| `contact.status eq 'active'` | `c.status = $n` |
| `contact.created_at in_last_days 30` | `c.created_at >= $2 - make_interval(days => $n)` (`$2` je `asOf`, **nikdy `now()`**) |
| `attribute.city eq 'Praha'` | `c.attributes @> jsonb_build_object($n, $m)` (index-friendly containment) |
| `attribute.city contains 'Pra'` | `(c.attributes ->> $n) ILIKE '%' \|\| $m \|\| '%'` |
| `attribute.order_total gt 1000` | `jsonb_typeof(c.attributes -> $n) = 'number' AND (c.attributes ->> $n)::numeric > $m` |
| `attribute.x is_empty` | `(c.attributes -> $n) IS NULL OR c.attributes ->> $n = ''` |
| `tag has_any [a,b]` | `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY($n::uuid[]))` |
| `tag has_all [a,b]` | `(SELECT count(*) FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY($n::uuid[])) = cardinality($n::uuid[])` |
| `list is_confirmed` | `EXISTS (SELECT 1 FROM list_subscriptions ls WHERE ls.contact_id = c.id AND ls.list_id = $n AND ls.status = 'confirmed')` |
| `consent is_granted` | `EXISTS (SELECT 1 FROM contact_consent_state s WHERE s.contact_id = c.id AND s.purpose = $n AND s.status = 'granted')` |
| `suppression is_not_suppressed` | `NOT EXISTS (SELECT 1 FROM suppressions su WHERE su.workspace_id = c.workspace_id AND su.removed_at IS NULL AND (su.email = c.email OR su.email_hash = c.email_hash))` |
| `engagement opened since_days 90 did` | `ce.last_open_at >= $2 - make_interval(days => $n)` (přes rollup, viz níže) |
| `segment in` | `EXISTS (SELECT 1 FROM segment_members sm WHERE sm.segment_id = $n AND sm.contact_id = c.id)` u statického, u dynamického se vloží zkompilovaný podvýraz |

V tabulce je pro čitelnost použitý alias `c`. Ve skutečnosti se vždy dosadí hodnota `opts.alias`, protože volající může mít v dotazu vlastní `c`.

**Čas se vyhodnotí jednou, na začátku, ne v každé dávce.**

Tohle je jediná věc v celém segmentačním enginu, která umí tiše zkazit odeslanou kampaň, a proto je závazná: **žádný zkompilovaný výraz nesmí obsahovat `now()`, `current_timestamp`, `localtimestamp` ani `CURRENT_DATE`.** Všechny relativní časové operátory (`in_last_days`, `not_in_last_days`, `in_next_days`, `since_days`, `on`, `before`, `after`) se kompilují proti pozicovému parametru `$2`, kterým je `opts.asOf`.

Proč: materializace publika u milionu kontaktů běží po dávkách a trvá minuty. Kdyby se `now()` vyhodnotilo v každé dávce znovu, dávka 1 a dávka 200 by viděly jiné publikum. Segment „neaktivní 90 dní" by kontakt na hraně okna v jedné dávce vyloučil a ve dvoustý zahrnul. Chyba je nedeterministická, projeví se jen u velkých kampaní a v logu po ní nezůstane stopa. Přesně ten druh chyby, který se ladí týden.

Pravidla:

| Kdo volá | Hodnota `asOf` |
|---|---|
| Materializace publika kampaně (část 4) | čas zahájení materializace, uložený na kampani, aby šlo publikum kdykoliv zreprodukovat |
| Náhled počtu v UI | čas přijetí požadavku |
| Job `segments.recount` | čas zahájení jobu |
| Zmrazení segmentu do statického | čas zmrazení |

`asOf` je vždy druhý parametr (`$2`), i když ho daný výraz nepoužije. Díky tomu je číslování stabilní a `paramOffset` se počítá jednoduše.

Testem se hlídá, že vygenerovaný SQL text neobsahuje `now(`, `current_timestamp`, `localtimestamp` ani `current_date`. Je to stejný druh testu jako ten na injection z akceptačního kritéria 27: netestuje se chování, testuje se **text dotazu**, protože chování by se muselo trefit do závodu.

Přetypování `::numeric` je vždy chráněné testem `jsonb_typeof(...) = 'number'`. Bez toho by jediná hodnota `"nevím"` v poli typu number shodila celý dotaz chybou 22P02 a segment by přestal fungovat, aniž by bylo jasné proč.

**Tříhodnotová logika.** Každý listový predikát se obalí `coalesce(<pred>, false)`. Důsledek, který musí být v UI napsaný: `NOT (city = 'Praha')` **nevrátí** kontakty, které město vůbec nemají. Pro ty je operátor `is_empty`. Bez tohohle pravidla by uživatel nikdy nepochopil, proč mu součet dvou doplňkových segmentů nedává celek.

**Engagement.** Pokud scope odpovídá jednomu z předpočítaných tvarů (`since_days ∈ {7, 30, 90}`, celkové součty, `last_n_campaigns`), kompiluje se proti rollup tabulce `contact_engagement`, kterou vlastní část 5 (viz 11.5). Jinak se použije `EXISTS` nad `messages` a `message_events`, a do odpovědi náhledu se přidá `warnings: ['segment_slow_engagement']` s textem „tenhle dotaz prochází historii kampaní a u velkých projektů může trvat déle".

#### 4.11.4 Limity složitosti

| Limit | Hodnota | Chyba při překročení |
|---|---|---|
| Celkový počet podmínek | 100 | `segment_too_complex` |
| Hloubka zanoření skupin | 5 | `segment_too_deep` |
| Potomků ve skupině | 50 | `segment_too_complex` |
| Podmínek typu `engagement` | 5 | `segment_too_many_engagement` |
| Podmínek typu `event` | 3 | `segment_too_many_event` |
| Hloubka odkazů na jiné segmenty | 2 | `segment_nesting_too_deep` |
| Cyklus v odkazech na segmenty | zakázán | `segment_cycle` |
| Položek v `in` / `not_in` | 1 000 | `segment_list_too_long` |
| Délka výsledného SQL | 64 kB | `segment_too_complex` |
| Velikost `definition` v JSON | 256 kB | `segment_definition_too_large` |

Detekce cyklu: před uložením se sestaví graf odkazů `segment → segment` a projde se do hloubky s množinou navštívených uzlů. Kontroluje se při zápisu, ne při čtení, aby zacyklený segment vůbec nemohl vzniknout.

#### 4.11.5 Náhled počtu

`POST /api/v1/segments/preview` s tělem `{ definition }` nebo `{ segment_id }`.

Postup:

1. Připojení z **read-only poolu** (`default_transaction_read_only = on`), takže chyba v kompilátoru nemůže nic zapsat. Pool se otevírá pod stejnou rolí `openengage_app`, takže se na něj RLS vztahuje beze změny.
2. V transakci: `SELECT set_config('openengage.workspace_id', $1, true)`, pak `SET LOCAL statement_timeout = 3000` (`SEGMENT_PREVIEW_TIMEOUT_MS`) a `SET LOCAL work_mem = '32MB'`. Pořadí je závazné, bez nastaveného kontextu vrátí RLS prázdný výsledek a náhled by tiše ukázal nulu.
3. `SELECT count(*) FROM contacts c WHERE ...`.
4. Když dotaz doběhne, odpověď je `{ count, exact: true, duration_ms, warnings }`.
5. Když skončí `57014 query_canceled`, spustí se `EXPLAIN (FORMAT JSON) SELECT 1 FROM contacts c WHERE ...` s timeoutem 500 ms a z plánu se přečte `Plan Rows`. Odpověď je `{ count: <odhad>, exact: false, warnings: ['segment_count_estimated'] }`. UI zobrazí „přibližně 12 000" a tlačítko „spočítat přesně", které zařadí job `segments.recount`.
6. Náhled zároveň vrací vzorek 20 kontaktů (`LIMIT 20`), což je levné i u pomalých predikátů, protože se nemusí projít celá tabulka.

Rate limit: 20 náhledů za minutu na uživatele. UI navíc debouncuje 500 ms a ruší předchozí požadavek přes `AbortController`, jinak by každý stisk klávesy v poli s hodnotou spustil dotaz nad 5 miliony řádků.

#### 4.11.6 Přepočet a čerstvost

Dynamické segmenty se **nematerializují**. `cached_count` je jen zobrazovací hodnota.

| Spouštěč | Chování |
|---|---|
| Otevření seznamu segmentů | segmenty s `cached_at < now() - 15 min` dostanou job `segments.recount`, `singletonKey = segment_id` |
| Cron každou hodinu | segmenty s `cached_at < now() - 6 h` |
| Dokončení importu | všechny segmenty projektu se označí jako zastaralé (`cached_at = NULL`) |
| Uložení segmentu | okamžitý přepočet |
| Ruční „přepočítat" | okamžitý přepočet |

Souběžnost: **2 přepočty na projekt, 4 globálně.** U 5 milionů kontaktů trvá `count(*)` s paralelním seq scanem zhruba 2 až 6 sekund. Projekt s 200 segmenty tedy spotřebuje 7 až 20 minut databázového času na jeden úplný cyklus, a proto je cyklus šestihodinový, ne pětiminutový. Kdyby se přepočítávalo častěji, segmenty by ukrádaly výkon odesílání.

Zastaralost je v UI vidět: pod počtem je „aktualizováno před 3 hodinami" a u hodnot starších než 6 hodin je číslo šedé s ikonou.

**Publikum kampaně se počítá znovu v okamžiku odeslání** (část 4), nikdy se nebere `cached_count`. Zastaralý cache proto nikdy neovlivní, komu se pošle.

#### 4.11.7 Statické segmenty

`kind = 'static'` je zmrazený seznam kontaktů v `segment_members`. Vzniká:

- z dynamického segmentu operací „zmrazit" (`POST /api/v1/segments/{id}/freeze`),
- z výsledku presetu čištění, aby si uživatel mohl seznam prohlédnout, než ho smaže,
- z ručního výběru v UI.

Statický segment se nepřepočítává. Kontakty z něj mizí jen kaskádou při smazání kontaktu.

### 4.12 Presety čištění databáze a reaktivace

Presety jsou hotové definice segmentů, které se založí kliknutím a jdou dál upravit. Ukládají se jako běžné segmenty s vyplněným `preset_key`.

Definice používají relativní operátory, které se kompilují proti `asOf` (4.11.3), ne proti `now()`.

| `preset_key` | Název (cs / en) | Definice |
|---|---|---|
| `never_opened` | Nikdy neotevřel / Never opened | `engagement.sent count_gte 3` AND `engagement.opened did_not` (bez omezení času) |
| `never_clicked` | Nikdy neklikl / Never clicked | `engagement.sent count_gte 5` AND `engagement.clicked did_not` |
| `inactive_90d` | Neaktivní 90+ dní / Inactive 90+ days | `contact.last_activity_at not_in_last_days 90` OR `contact.last_activity_at is_empty`, AND `contact.created_at not_in_last_days 90` |
| `no_open_last_n` | Neotevřel posledních 5 kampaní / No opens in last 5 campaigns | `engagement.opened { last_n_campaigns: 5 } did_not` AND `engagement.sent { last_n_campaigns: 5 } count_gte 5` |
| `unconfirmed_30d` | Nepotvrzené přihlášení starší 30 dní / Unconfirmed for 30+ days | `list.is_pending` AND `contact.created_at not_in_last_days 30` |
| `repeated_soft_bounces` | Opakované měkké odrazy / Repeated soft bounces | `engagement.bounced count_gte 3` AND `contact.status eq 'active'` |

Podmínka „poslali jsme mu aspoň N zpráv" u prvních dvou presetů je podstatná: bez ní by do „nikdy neotevřel" spadli i lidé, kterým jsme ještě nic neposlali, a to je nejčastější chyba v konkurenčních nástrojích.

**Reaktivační scénář** je hotová sekvence, ne jen segment:

1. Založí se segment podle presetu, uživatel vidí počet a vzorek.
2. Segment se **zmrazí** do statického, aby se během kampaně neměnil.
3. Vytvoří se kampaň z připravené šablony „Chceme vědět, jestli vás to ještě zajímá" s jedním tlačítkem „Ano, posílejte dál", které vede na `POST /r/{token}`. Kliknutí zapíše `contacts.last_activity_at = now()`, nový záznam souhlasu se zdrojem `reactivation` a přidá štítek `reaktivovan`.
4. Naplánuje se úklidový job `contacts.cleanup_after_reactivation` na `now() + N dní` (výchozí 14, volitelně 7 až 60), který u kontaktů zmrazeného segmentu **bez** štítku `reaktivovan` provede zvolenou akci.
5. Akce na výběr: `unsubscribe_all` (výchozí), `tag_only` (jen označit, nic nemazat), `delete` (měkké smazání, jen owner).
6. Před spuštěním úklidu přijde uživateli v aplikaci a e-mailem přehled: „Za 3 dny odhlásíme 1 842 kontaktů. Zkontrolovat · Odložit · Zrušit."

Krok 6 existuje proto, že hromadné odhlášení je nevratná operace nad daty, která uživatel roky sbíral. Musí mít poslední slovo a musí ho mít včas.

### 4.13 Embedovatelné formuláře

#### 4.13.1 Způsoby vložení

| Varianta | Kód | Kdy |
|---|---|---|
| Skript | `<script async src="https://APP_URL/f/{slug}.js"></script><div data-oe-form="{slug}"></div>` | výchozí, nejlepší vzhled |
| iframe | `<iframe src="https://APP_URL/f/{slug}" width="100%" height="320" style="border:0"></iframe>` | pro CMS, kde nejde vložit skript |
| Čisté HTML | `<form action="https://APP_URL/f/{slug}/submit" method="post">...</form>` | plná kontrola nad vzhledem, funguje bez JavaScriptu |

Skriptová varianta vykresluje formulář do **shadow DOM**, takže CSS hostitelské stránky nemůže rozbít vzhled a naopak. Velikost skriptu je limitovaná na 12 kB gzip. Skript sám o sobě nic netrackuje, je oddělený od trackovacího SDK z části 5.

#### 4.13.2 Chování bez JavaScriptu

Endpoint `POST /f/{slug}/submit` přijímá `application/json` i `application/x-www-form-urlencoded`. U `x-www-form-urlencoded` odpoví `303 See Other` na `redirect_url`, nebo na hostovanou děkovací stránku `GET /f/{slug}/thanks`. Skriptová varianta posílá JSON a zpracuje odpověď sama.

Čistě HTML formulář tedy funguje i s vypnutým JavaScriptem, jen bez ochrany časovou pastí a bez nonce (viz níže). Uživatel je na to při generování kódu upozorněný.

#### 4.13.3 Ochrana proti zneužití

Klasická CSRF ochrana tady nedává smysl: formulář z definice běží na cizí doméně a endpoint nesmí číst cookie. Ochrana stojí na pěti nezávislých vrstvách:

| Vrstva | Mechanismus | Co zastaví |
|---|---|---|
| Původ | `Origin` nebo `Referer` musí odpovídat `forms.allowed_origins`. Prázdný seznam znamená libovolný původ, ale UI u toho zobrazí varování | vložení formuláře na cizí web |
| Nonce | `GET /f/{slug}` vrátí `{ nonce, issued_at }`, kde nonce je HMAC nad `(form_id, issued_at, prefix IP adresy)` s platností 30 minut. Submit bez platného nonce se odmítne | slepé skriptované odesílání bez načtení stránky |
| Časová past | Submit dřív než `min_fill_seconds` (výchozí 2 s) po vydání nonce se **tiše zahodí** (odpověď 200, `form_submissions.status = 'dropped'`) | jednoduché boty |
| Honeypot | Skryté pole se jménem z `honeypot_field` (výchozí `website`). Neprázdné → tiše zahodit | jednoduché boty |
| Rate limit | 5 odeslání za minutu a 30 za hodinu na IP, 100 za minutu na formulář globálně | zahlcení |

Odmítnutí botem je vždy **tiché**: odpoví se stejným úspěchem jako u platného odeslání. Bot se tak nedozví, které pravidlo ho chytilo.

Volitelně `captcha_provider` (`turnstile` nebo `hcaptcha`). **Ve výchozím stavu vypnuté a v UI výslovně označené**, protože posílá data návštěvníka třetí straně, což je v rozporu s pravidlem 4 hlavní specifikace („nulová povinná komunikace s naším ani cizím cloudem"). Do výchozího buildu se nepřidává žádná závislost, integrace je jen HTTP volání na ověřovací endpoint.

#### 4.13.4 Double opt-in u formulářů

`forms.double_opt_in` je **ve výchozím stavu zapnuté** a jeho vypnutí vyžaduje potvrzení dialogu s textem:

> Bez potvrzovacího e-mailu může kdokoliv přihlásit cizí adresu. Zvyšuje to riziko stížností na spam a v některých případech to znamená, že souhlas nedokážete doložit. Opravdu vypnout?

Anglicky: „Without a confirmation email, anyone can subscribe someone else's address. This increases the risk of spam complaints and may leave you unable to prove consent. Turn it off anyway?"

#### 4.13.5 Pole formuláře

```ts
type FormField = {
  target: 'email' | 'first_name' | 'last_name' | 'full_name' | 'locale'
        | { attribute: string };            // musí existovat v contact_fields
  label: { cs: string; en: string };
  placeholder?: { cs: string; en: string };
  required: boolean;
  type: 'text' | 'email' | 'select' | 'checkbox' | 'date' | 'number' | 'hidden';
  options?: { value: string; label: { cs: string; en: string } }[];
  defaultValue?: string;
};
```

Formulář smí zapisovat **jen** do polí, která existují v `contact_fields`, plus do pevných polí kontaktu. Neznámý klíč vede na `422 validation_failed` s `unknown_field_key` už při ukládání formuláře, ne až při odeslání. Bez tohohle pravidla by se formulář stal libovolným úložištěm dat bez schématu.

Limity: max 15 polí, label max 200 znaků, hodnota max 1 000 znaků.

#### 4.13.6 Co se stane po odeslání

1. Ověření vrstev z 4.13.3. Selhání „tiché" vrstvy → 200 a `status = 'dropped'`, konec.
2. Validace polí. Chyba → `422` s poli `details: [{ field, code }]`, `status = 'rejected'`, payload se **neuloží** (mohl by obsahovat nesmysly z botů).
3. Kontrola suppression. `complaint` nebo `gdpr_erasure` → vrátí se **standardní úspěch**, ale nic se nezapíše. Nikdy se nepotvrzuje cizímu člověku, že je adresa blokovaná.
4. Upsert kontaktu v režimu `update` (formulář nikdy nemaže data).
5. Přihlášení do `list_ids`, podle `double_opt_in` do `pending` nebo `confirmed`.
6. Přidání `tag_ids`.
7. Zápis souhlasu s důkazem: `consent_text`, `consent_text_hash`, `page_url`, `ip`, `user_agent`, `form_id`, `mapping_version`, čas.
8. Zápis do `form_submissions` se `status = 'accepted'`.
9. Odeslání potvrzovacího e-mailu (přes část 4).
10. Odpověď: JSON `{ ok: true, double_opt_in: true }` nebo `303` na `redirect_url`.

Opakované odeslání téže adresy do stejného formuláře do 60 sekund se považuje za dvojklik: vrátí se úspěch, ale nepošle se druhý potvrzovací e-mail.

### 4.14 Souhlasy a GDPR

#### 4.14.1 Model souhlasu

Souhlas je samostatný objekt s historií, ne příznak na kontaktu (kapitola 5 hlavní specifikace). Ke každému záznamu se ukládá:

| Pole | Význam |
|---|---|
| `purpose` | `email_marketing`, `analytics`, `personalization`, `profiling`, `third_party` |
| `scope_list_id` | `NULL` = celý projekt, jinak konkrétní seznam |
| `status` | `granted` nebo `withdrawn` |
| `legal_basis` | `consent`, `legitimate_interest`, `contract`, `soft_opt_in` |
| `source` | odkud to přišlo |
| `consent_text` | **doslovné znění**, které člověk odsouhlasil |
| `consent_text_hash` | SHA-256 znění, kvůli porovnání verzí formuláře |
| `evidence` | `{ ip, user_agent, page_url, form_id, form_version, double_opt_in_at, confirmation_ip, import_id, declaration }` |
| `occurred_at` | kdy se to stalo (import může nést historické datum) |
| `recorded_by` | uživatel nebo `system` |

`legal_basis = 'soft_opt_in'` odpovídá výjimce pro existující zákazníky (v ČR § 7 zákona č. 480/2004 Sb.). Produkt ji umí zaznamenat a odlišit, ale **neposuzuje**, jestli je v konkrétním případě použitelná. V UI je u ní text: „Použijte jen u vlastních zákazníků, kterým nabízíte obdobné zboží nebo služby a kteří měli možnost odmítnout už při získání adresy."

Aktuální stav se udržuje v `contact_consent_state` v téže transakci. Segment „má souhlas" čte jen tuhle tabulku.

#### 4.14.2 Přístup a přenositelnost (čl. 15 a 20)

Vstupní body:
- tlačítko „Stáhnout kopii mých údajů" na stránce preferencí (identita je prokázaná držením podepsaného tokenu z e-mailu, který jsme sami odeslali),
- `POST /api/v1/gdpr-requests` ze strany správce,
- ruční založení v administraci.

Job `gdpr.export_subject` sestaví ZIP:

| Soubor | Obsah |
|---|---|
| `contact.json` | všechna pole kontaktu včetně `attributes`, v čitelném tvaru |
| `consents.csv` | historie souhlasů včetně znění a důkazů |
| `subscriptions.csv` | seznamy, stavy, data |
| `tags.csv` | štítky |
| `messages.csv` | odeslané zprávy: kampaň, předmět, čas odeslání, stav (data z části 4) |
| `message_events.csv` | otevření a kliknutí (data z části 5) |
| `web_events.ndjson` | chování na webu (data z části 5) |
| `form_submissions.csv` | odeslané formuláře |
| `imports.csv` | ze kterých importů kontakt pochází |
| `README.txt` | vysvětlení sloupců česky a anglicky |

JSON i CSV splňují požadavek čl. 20 na „strukturovaný, běžně používaný a strojově čitelný formát".

Odkaz ke stažení je jednorázový podepsaný token s platností 7 dní, po vypršení se soubor smaže. Lhůta pro vyřízení je podle čl. 12 odst. 3 **jeden měsíc od doručení žádosti**, prodloužitelná o **další dva měsíce** s tím, že o prodloužení a jeho důvodech musí být subjekt informován **do jednoho měsíce** od doručení. Ověřeno proti textu nařízení 2026-07-31. `due_at` se počítá při založení žádosti, prodloužení zapisuje `extended_until` a `extension_reason` a systém pošle upozornění den před vypršením.

#### 4.14.3 Oprava a omezení (čl. 16 a 18)

Oprava: pole s `subject_editable = true` plus jméno, příjmení a jazyk jdou upravit přímo na stránce preferencí. Změna se zapíše do auditu se zdrojem `preference_center`.

Omezení: `contacts.processing_restricted = true`. Kompilátor segmentů takový kontakt vždy vyloučí a materializace publika ho nesmí zařadit. Nic se nemaže, jen se nezpracovává. Zrušit omezení může jen správce.

#### 4.14.4 Výmaz (čl. 17)

Dva režimy.

**`anonymize` (výchozí).** V jedné transakci:

| Objekt | Akce |
|---|---|
| `contacts.email` | `erased+{contact_id}@erased.invalid` |
| `contacts.email_hash` | ponechá se původní HMAC, viz níže |
| `contacts.first_name`, `last_name`, `middle_name`, `title_*`, vokativy, `greeting` | `NULL` / prázdný řetězec |
| `contacts.gender` | `unknown` |
| `contacts.attributes` | `{}` |
| `contacts.locale`, `timezone`, `source_ref` | `NULL` nebo výchozí |
| `contacts.status` | `deleted` |
| `contacts.deleted_at`, `anonymized_at` | `now()` |
| `consents` | **smazány** (role s právem obejít append-only) |
| `contact_consent_state` | smazáno |
| `list_subscriptions` | smazáno |
| `contact_tags` | smazáno |
| `segment_members` | smazáno |
| `form_submissions.payload`, `ip`, `user_agent`, `page_url` | vyprázdněno |
| `import_errors.raw_line` obsahující adresu | nahrazeno `[erased]` |
| `subscription_confirmations` | smazáno |
| `suppressions` | vloží se řádek `reason = 'gdpr_erasure'`, `email` = placeholder, `email_hash` = HMAC původní adresy |

Následně asynchronně (job `gdpr.sever_links`, s vlastním sledováním dokončení):

| Objekt | Akce | Vlastní |
|---|---|---|
| `messages.contact_id` | `NULL`, `messages.email` na placeholder, `render_data` na `{}` | část 4 |
| `web_events.contact_id` | `NULL` | část 5 |
| `identities` | smazáno | část 5 |
| `contact_engagement` | smazáno | část 5 |

**Co se stane se statistikami.** `message_events` a `web_events` se **nemažou**, jen se odstřihne vazba na osobu. Události si nechávají `campaign_id`, typ a čas. Důsledek: **agregované statistiky kampaní se výmazem nemění.** Kampaň, která včera vykazovala 4 812 otevření, jich vykazuje 4 812 i po výmazu. Ztrácí se jen možnost říct, kdo to byl.

Je to vědomé rozhodnutí. Alternativa (smazat i události) by znamenala, že se čísla v uzavřených reportech zpětně mění, a report, jehož čísla se mění, je k ničemu. Zároveň událost bez vazby na osobu je statistický údaj, ne osobní údaj.

**Proč se drží otisk adresy.** `suppressions.email_hash` je jediná stopa, která po výmazu zbývá, a existuje proto, aby příští import stejného souboru smazaného člověka nevzkřísil. Bez ní by výmaz vydržel do dalšího importu, což by bylo horší porušení než samotný otisk.

Otisk je **HMAC-SHA256 s vyhrazeným klíčem `SUPPRESSION_HASH_KEY`**, ne prostý SHA-256. Prostý hash e-mailu je slovníkovým útokem prolomitelný v řádu minut, takže by to nebyl anonymizovaný údaj. HMAC s tajným klíčem, který neopouští instalaci, tenhle útok znemožňuje. Klíč se **nesmí rotovat**, jinak přestanou fungovat všechny existující otisky; to je požadavek na část 1.

**`purge`.** `DELETE FROM contacts WHERE id = $1`, kaskády smažou všechno navázané. Zůstává jen řádek v `suppressions` a záznam v `gdpr_requests` s otiskem a počty. Dostupné jen vlastníkovi projektu. Riziko: kontakt se může vrátit dalším importem, protože v `contacts` po něm nezbude nic. Tomu brání jen suppression řádek, proto se zakládá i v tomhle režimu.

#### 4.14.5 Námitka a odvolání souhlasu (čl. 21 a 7 odst. 3)

Námitka proti přímému marketingu je podle čl. 21 odst. 3 **absolutní**, žádné vyvažování zájmů se nedělá. V produktu je proto totožná s globálním odhlášením: `suppressions(global_unsubscribe)`, souhlas `withdrawn` se `source = 'objection'`, všechny seznamy odhlášené.

Odvolání souhlasu podle čl. 7 odst. 3 musí být „stejně snadné jako jeho udělení". Splněno tím, že v každém e-mailu je jednokliknutové odhlášení bez přihlášení a bez dalších kroků.

#### 4.14.6 Ověření totožnosti žadatele

| Kanál | Ověření |
|---|---|
| Stránka preferencí | držení podepsaného tokenu z e-mailu, který jsme sami poslali na tuto adresu, je dostatečný důkaz |
| Administrace | správce zakládá žádost jménem subjektu, žádost jde do stavu `verifying` a systém pošle na adresu potvrzovací e-mail; teprve kliknutí ji posune na `processing` |
| API | vyžaduje scope `gdpr:manage`, chová se jako administrace |

Neověřená žádost o výmaz se **nikdy neprovádí**. Jinak by stačilo znát cizí adresu a nechat ji smazat, což je útok na cizí data.

#### 4.14.7 Události pro odchozí webhooky

Tato část deklaruje obsah, doručovací infrastrukturu vlastní část 1.

| Událost | Kdy | Payload |
|---|---|---|
| `contact.created` | nový kontakt | `{ id, email, first_name, last_name, source, created_at }` |
| `contact.updated` | změna polí | `{ id, email, changed: string[] }` |
| `contact.subscribed` | přechod na `confirmed` | `{ contact_id, email, list_id, list_name, source, confirmed_at }` |
| `contact.unsubscribed` | přechod na `unsubscribed` | `{ contact_id, email, list_id \| null, scope: 'list' \| 'global', reason }` |
| `contact.suppressed` | zápis do suppression | `{ email, reason, source }` |
| `contact.deleted` | anonymizace nebo purge | `{ contact_id, mode }` (bez e-mailu) |
| `import.completed` | dokončení importu | `{ import_id, status, created, updated, errors }` |
| `segment.recomputed` | dokončení přepočtu | `{ segment_id, count, exact }` |
| `gdpr.request_completed` | vyřízení žádosti | `{ request_id, type, completed_at }` (bez e-mailu) |

### 4.15 Retence

| Cíl | Výchozí | Akce | Poznámka |
|---|---|---|---|
| `import_files` | 30 dní | delete | maže se soubor z úložiště, řádek `imports` zůstává |
| `import_errors` | 90 dní | delete | obsahuje syrové řádky, tedy osobní údaje |
| `form_submissions` | 180 dní | anonymize | `payload`, `ip`, `user_agent` na prázdno; řádek zůstává kvůli statistice |
| `inbound_deliveries` | 30 dní | delete | drop partition |
| `unconfirmed_subscriptions` | 30 dní | delete | `list_subscriptions` ve stavu `pending` starší než N dní |
| `exports` | 7 dní | delete | soubor i řádek |
| `inactive_contacts` | vypnuto | anonymize | kontakt bez aktivity a bez odeslané zprávy déle než N dní |

Mechanismus: pg-boss cron `retention.run` denně, spouštěný pro každý projekt zvlášť s rozprostřením v čase (offset odvozený z hashe `workspace_id`, aby se sto projektů nespustilo v jednu sekundu). `singletonKey = workspace_id`.

Průběh jednoho běhu:

1. Založí se `retention_runs` se stavem `running`.
2. Pro každou zapnutou politiku se maže po dávkách 5 000 řádků, mezi dávkami pauza 100 ms, aby retence nekonkurovala odesílání.
3. Tvrdý strop 30 minut na běh. Když se nestihne, stav je `partial` a pokračuje se další noc.
4. Zapíší se počty do `retention_runs` a jeden souhrnný záznam do `audit_log`.

Pojistky:

- `consents` a `suppressions` retence **nikdy nemaže**. Jsou to důkazy o zákonnosti zpracování a o zákazu odesílání.
- Změna politiky, která by v prvním běhu smazala víc než 10 procent řádků cílové tabulky, vyžaduje potvrzení dialogu s uvedením konkrétního počtu.
- Globální dolní mez `RETENTION_MIN_DAYS` (výchozí 1) brání nastavení nuly.
- Politiku smí měnit jen vlastník projektu.

### 4.16 Příchozí webhooky

#### 4.16.1 Endpoint a ověření

`POST /api/v1/inbound/{slug}`, kde `slug` je 24 až 40 náhodných znaků. Sám o sobě je slug slabé tajemství, proto je výchozí `signature_mode = 'hmac_sha256'`.

| Režim | Konfigurace | Ověření |
|---|---|---|
| `none` | `ip_allowlist` | jen slug a případně IP; UI zobrazuje varování |
| `hmac_sha256` | `{ header, encoding: 'hex' \| 'base64', template, timestamp_header, tolerance_seconds }` | HMAC nad šablonou, porovnání v konstantním čase |
| `shared_secret` | `{ header }` | hodnota hlavičky se rovná tajemství, porovnání v konstantním čase |
| `basic` | `{ username }` | HTTP Basic |

Šablona pro HMAC je řetězec s placeholdery, například `{timestamp}.{body}` (Stripe) nebo `{body}` (Shopify). Podporované placeholdery: `{body}` (syrové tělo, bajt na bajt, před parsováním JSON), `{timestamp}`, `{slug}`. Nic víc, žádné výrazy.

Ochrana proti replay: když je nakonfigurovaný `timestamp_header`, odmítne se požadavek, jehož časové razítko se liší o víc než `tolerance_seconds` (výchozí 300). Navíc dedup podle `external_id`.

Syrové tělo se musí zachovat pro ověření podpisu, takže route handler čte `req.arrayBuffer()` a JSON parsuje až po ověření.

Limity: tělo max 1 MB (`413`), 100 požadavků za sekundu na endpoint s burstem 500 (`429` s `Retry-After`).

#### 4.16.2 Mapování bez psaní kódu

```jsonc
{
  "version": 1,
  "event":      { "path": "$.type",
                  "map": { "order.created": "subscribe", "customer.deleted": "unsubscribe",
                           "customer.updated": "update" },
                  "default": "ignore" },
  "external_id": { "path": "$.id" },
  "contact": {
    "email":      { "path": "$.data.customer.email", "required": true },
    "first_name": { "path": "$.data.customer.first_name" },
    "last_name":  { "path": "$.data.customer.last_name" },
    "full_name":  { "path": "$.data.customer.name", "split": true },
    "locale":     { "path": "$.data.customer.locale", "transform": "language_tag" },
    "attributes": {
      "order_total": { "path": "$.data.total_price", "type": "number" },
      "city":        { "path": "$.data.shipping_address.city", "type": "text" },
      "last_order_at": { "path": "$.created_at", "type": "datetime" }
    }
  },
  "lists": ["<list-uuid>"],
  "tags":  ["zakaznik"],
  "consent": {
    "purpose": "email_marketing",
    "legal_basis": "soft_opt_in",
    "when": { "path": "$.data.customer.accepts_marketing", "equals": true },
    "consent_text": "Souhlasím se zasíláním novinek."
  },
  "on_conflict": "update"
}
```

Gramatika přístupové cesty je záměrně minimální: `$` je kořen, `.klíč` je vlastnost, `[n]` je index pole. **Žádné wildcardy, žádné filtry, žádné výrazy, žádný `eval`.** Neexistující cesta vrací `null`. `required: true` a `null` znamená odmítnutí doručení s `mapping_required_missing`.

Povolené transformace: `lowercase`, `uppercase`, `trim`, `language_tag` (z `cs-CZ` udělá `cs`), `unix_seconds` a `unix_millis` (číslo na `datetime`), `boolean` (řetězce podle tabulky ze 4.2.4).

Odmítnuta byla varianta „malý skriptovací jazyk". Cokoliv spustitelného v payloadu z internetu je zbytečné bezpečnostní riziko a deklarativní mapování pokryje reálné e-shopové webhooky.

#### 4.16.3 Neznámý tvar payloadu

Doručení, které projde podpisem, ale nedá se namapovat, se **neztratí**. Uloží se se `status = 'unmapped'` a celým payloadem po dobu retence (výchozí 30 dní).

V UI je pak průvodce:

1. Uživatel založí endpoint, dostane URL a nastaví ji u e-shopu.
2. Nechá e-shop poslat jednu skutečnou událost. Ta dorazí a uloží se jako `unmapped`.
3. Průvodce zobrazí posledních 20 doručení jako rozbalovací JSON strom. Uživatel klikne na hodnotu a přiřadí ji k cíli („tohle je e-mail", „tohle je město").
4. `POST /api/v1/inbound/{id}/test` s návrhem mapování přehraje uložené doručení a ukáže, jaký kontakt by vznikl, **bez zápisu do databáze**.
5. Po uložení mapování nabídne „zpracovat zpětně 47 nezmapovaných doručení".

Tohle je odpověď na „mapování bez psaní kódu", která reálně funguje: tvar payloadu se nehádá, přijme se skutečný a ukáže se na něj prstem.

#### 4.16.4 Odpovědi a zpracování

| Situace | HTTP | Tělo |
|---|---|---|
| Podpis platný, tělo je JSON | `202` | `{ "delivery_id": "..." }` |
| Duplicitní `external_id` | `202` | `{ "delivery_id": "<původní>", "duplicate": true }` |
| Podpis neplatný nebo chybí | `401` | chybový objekt bez detailů |
| IP mimo allowlist | `403` | |
| Tělo větší než 1 MB | `413` | |
| Tělo není JSON | `400` | |
| Endpoint neaktivní nebo neexistuje | `404` | |
| Rate limit | `429` | s hlavičkou `Retry-After` |

Zpracování je **asynchronní** (job `inbound.process`). Chyby mapování se nepromítají do HTTP odpovědi, protože pomalá nebo chybující databáze by jinak způsobila, že e-shop bude donekonečna opakovat doručení. Výsledek je vidět v logu doručení s filtrem podle stavu.

Idempotence: unikátní `(endpoint_id, external_id)` v `inbound_dedup`. Když `external_id` v payloadu není, dedup se nedělá a v UI se u endpointu zobrazí upozornění „bez identifikátoru události nedokážeme rozpoznat opakované doručení".

---

## 5. Rozhraní

### 5.1 Kontakty

| Metoda | Cesta | Scope | Popis |
|---|---|---|---|
| `GET` | `/api/v1/contacts` | `contacts:read` | seznam s filtrem a kurzorem |
| `POST` | `/api/v1/contacts` | `contacts:write` | vytvoření nebo upsert |
| `GET` | `/api/v1/contacts/{id}` | `contacts:read` | detail |
| `PATCH` | `/api/v1/contacts/{id}` | `contacts:write` | částečná úprava |
| `DELETE` | `/api/v1/contacts/{id}?mode=soft\|anonymize\|purge` | `contacts:write` | mazání |
| `POST` | `/api/v1/contacts/{id}/restore` | `contacts:write` | obnova měkce smazaného |
| `POST` | `/api/v1/contacts/{id}/change-email` | `contacts:write` | změna klíče |
| `POST` | `/api/v1/contacts/lookup` | `contacts:read` | vyhledání podle e-mailu (POST kvůli tomu, aby adresa nebyla v URL a v logu) |
| `POST` | `/api/v1/contacts/batch` | `contacts:write` | dávkový upsert, max 1 000 položek |
| `GET` | `/api/v1/contacts/{id}/timeline` | `contacts:read` | vlastní část 5, uvedeno pro úplnost |

```ts
type ContactUpsertRequest = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;        // rozdělí se podle 4.4.3
  title_prefix?: string | null;
  title_suffix?: string | null;
  gender?: 'female' | 'male' | 'unknown';
  first_name_vocative?: string | null;   // zadání zamkne vokativ
  last_name_vocative?: string | null;
  locale?: string;
  attributes?: Record<string, string | number | boolean | string[] | null>;
  tags?: string[];                  // jména nebo id, neexistující se založí jen s ?create_tags=true
  lists?: { list_id: string; status?: 'pending' | 'confirmed' }[];
  consent?: {
    purpose: 'email_marketing' | 'analytics' | 'personalization' | 'profiling' | 'third_party';
    status: 'granted' | 'withdrawn';
    legal_basis: 'consent' | 'legitimate_interest' | 'contract' | 'soft_opt_in';
    consent_text?: string;
    occurred_at?: string;
    evidence?: Record<string, unknown>;
  }[];
  on_conflict?: 'create' | 'skip' | 'update' | 'overwrite';   // výchozí 'update'
  source?: string;
};

type ContactResponse = {
  id: string;
  email: string;
  status: 'active' | 'unconfirmed' | 'unsubscribed' | 'bounced' | 'complained' | 'deleted';
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  title_prefix: string | null;
  title_suffix: string | null;
  gender: 'female' | 'male' | 'unknown';
  gender_source: string;
  first_name_vocative: string | null;
  last_name_vocative: string | null;
  vocative_confidence: 'high' | 'low' | 'none';
  vocative_locked: boolean;
  greeting: string;
  locale: string;
  attributes: Record<string, unknown>;
  tags: { id: string; name: string }[];
  lists: { list_id: string; name: string; status: string; subscribed_at: string;
           confirmed_at: string | null; snooze_until: string | null }[];
  consents: { purpose: string; status: string; legal_basis: string; since: string }[];
  suppression: { reason: string; created_at: string } | null;
  processing_restricted: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
};
```

Parametry `GET /api/v1/contacts`: `q` (fulltext přes `search_text`), `status`, `list_id`, `tag_id`, `segment_id`, `created_after`, `created_before`, `vocative_confidence`, `order`, `limit`, `cursor`.

Povolené hodnoty `order` (konvence 4.3 části 1, každá musí mít krycí index): `created_at.desc` (výchozí), `created_at.asc`, `updated_at.desc`, `last_activity_at.desc`. Řazení podle `email` ani `last_name` **není povolené**, protože by potřebovalo další dva indexy nad tabulkou s pěti miliony řádků; třídění v UI se dělá až nad načtenou stránkou.

Odpověď má obálku `{ data: ContactResponse[], pagination: { next_cursor, prev_cursor, has_more, limit } }`. Celkový počet se **nevrací**, na to je `POST /api/v1/segments/preview`.

Chyby: `422 validation_failed` (`invalid_email`, `unknown_field_key`, ...), `409 already_exists` (jen `on_conflict = "create"`), `409 already_exists` s `email_taken_by_live_contact` u změny adresy a u obnovy, `409 conflict` s `contact_suppressed` (u `complaint` a `gdpr_erasure`), `429 quota_exceeded` s `contact_limit_reached`, `404 not_found` u cizího nebo neexistujícího ID.

`POST /api/v1/contacts` a `POST /api/v1/contacts/batch` vyžadují hlavičku `Idempotency-Key` (4.4 části 1). `DELETE` vrací `204` bez těla.

### 5.2 Vlastní pole a štítky

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` / `POST` | `/api/v1/contact-fields` | seznam, vytvoření |
| `PATCH` / `DELETE` | `/api/v1/contact-fields/{id}` | úprava (bez typu), smazání se stripováním hodnot |
| `POST` | `/api/v1/contact-fields/{id}/archive` | archivace |
| `POST` | `/api/v1/contact-fields/{id}/index` | zapnutí indexu, vrací `202` a stav |
| `GET` / `POST` | `/api/v1/tags` | |
| `PATCH` / `DELETE` | `/api/v1/tags/{id}` | |
| `POST` | `/api/v1/tags/{id}/merge` | tělo `{ into_tag_id }` |
| `POST` | `/api/v1/contacts/tags:bulk` | tělo `{ filter, add, remove }` |

Chyby: `409 already_exists` (klíč pole obsazený), `422 validation_failed` s `field_key_reserved`, `409 conflict` s `field_type_immutable`, `422 too_many_items` s `field_limit_reached` nebo `indexed_field_limit_reached`.

### 5.3 Import a export

| Metoda | Cesta | Popis |
|---|---|---|
| `POST` | `/api/v1/contacts/imports` | multipart upload souboru, vrací `201` s `{ id, status: 'pending' }` |
| `GET` | `/api/v1/contacts/imports` | seznam |
| `GET` | `/api/v1/contacts/imports/{id}` | stav a čítače |
| `GET` | `/api/v1/contacts/imports/{id}/preview` | detekce, mapování, 20 řádků |
| `PATCH` | `/api/v1/contacts/imports/{id}` | úprava `mapping`, `options`, `encoding`, `delimiter` (jen ve stavu `previewing`) |
| `POST` | `/api/v1/contacts/imports/{id}/confirm` | spuštění |
| `POST` | `/api/v1/contacts/imports/{id}/cancel` | zrušení |
| `GET` | `/api/v1/contacts/imports/{id}/errors` | stránkovaný seznam chyb |
| `GET` | `/api/v1/contacts/imports/{id}/errors.csv` | chybné řádky ke stažení a opravě |
| `GET` | `/api/v1/contacts/imports/{id}/events` | SSE stream průběhu |
| `POST` | `/api/v1/contacts/exports` | založení exportu |
| `GET` | `/api/v1/contacts/exports/{id}` | stav |
| `GET` | `/api/v1/contacts/exports/{id}/download?token=...` | stažení, jednorázově |

`POST /api/v1/contacts/imports` může místo souboru přijmout i `{ rows: [...] }` v JSON (max 10 000 řádků), což je cesta pro API klienty bez souboru.

Chyby: `409 conflict` s `import_duplicate`, `423 resource_locked` s `import_already_running`, `413 payload_too_large`, `422 validation_failed` s `no_email_column_mapped`, `409 invalid_state_transition` u operace mimo povolený stav.

`POST /api/v1/contacts/imports` vyžaduje `Idempotency-Key`. Timeout requestu je 120 s podle 4.1 části 1; samotný import běží asynchronně, request jen nahraje soubor a vrátí `202`.

### 5.4 Seznamy a přihlášení

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` / `POST` | `/api/v1/lists` | |
| `GET` / `PATCH` / `DELETE` | `/api/v1/lists/{id}` | mazání jen archivace |
| `GET` | `/api/v1/lists/{id}/stats` | počty podle stavu |
| `POST` | `/api/v1/lists/{id}/subscribe` | tělo `{ email, first_name?, ..., skip_confirmation?: boolean }`, respektuje double opt-in |
| `DELETE` | `/api/v1/lists/{id}/subscribe` | odhlášení, tělo `{ email, reason? }` |
| `POST` | `/api/v1/lists/{id}/subscribe:bulk` | max 1 000 adres |
| `POST` | `/api/v1/lists/{id}/resend-confirmation` | tělo `{ contact_id }` |

`skip_confirmation: true` vyžaduje scope `contacts:write` a navíc `declaration: true` v těle, chová se jako import s prohlášením o doloženém souhlasu.

Veřejné cesty (bez autentizace): `GET|POST /s/c/{token}` (potvrzení), `GET|POST /u/{token}` (odhlášení), `GET|POST /p/{token}` (preference), `GET /f/{slug}`, `POST /f/{slug}/submit`, `POST /r/{token}` (reaktivace).

Chyby: `409 conflict` s `subscribe_blocked_suppressed` nebo `subscribe_blocked_complaint`, `429 rate_limited` s `retry_after` u limitu opakovaného odeslání potvrzení, `404 not_found` u neexistujícího nebo cizího seznamu.

### 5.5 Segmenty

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` / `POST` | `/api/v1/segments` | |
| `GET` / `PATCH` / `DELETE` | `/api/v1/segments/{id}` | |
| `POST` | `/api/v1/segments/preview` | tělo `{ definition }` nebo `{ segment_id }` |
| `GET` | `/api/v1/segments/{id}/preview` | počet a vzorek, viz kapitola 6.8 hlavní specifikace |
| `POST` | `/api/v1/segments/{id}/recount` | vynucený přesný přepočet, vrací `202` |
| `POST` | `/api/v1/segments/{id}/freeze` | vytvoří statický segment |
| `GET` | `/api/v1/segments/{id}/contacts` | kurzorovaný seznam členů |
| `GET` | `/api/v1/segments/presets` | katalog presetů |
| `POST` | `/api/v1/segments/presets/{key}` | založí segment z presetu |
| `GET` | `/api/v1/segments/schema` | JSON Schema AST verze 1, pro klienty a validátory |

```ts
type SegmentPreviewResponse = {
  count: number;
  exact: boolean;
  duration_ms: number;
  sample: { id: string; email: string; first_name: string | null; last_name: string | null }[];
  warnings: ('segment_unindexed_field' | 'segment_slow_engagement'
           | 'segment_count_estimated' | 'segment_archived_field')[];
};
```

Chyby: `422 validation_failed` s `segment_invalid_ast`, `segment_operator_not_allowed` nebo `segment_invalid_range`; `422 too_many_items` s `segment_too_complex`, `segment_too_deep`, `segment_cycle` nebo `segment_list_too_long`; `404 not_found` s `segment_reference_not_found`; `504 dependency_timeout` s `segment_preview_timeout` (jen když selže i odhad z `EXPLAIN`).

### 5.6 Suppression, souhlasy, GDPR, retence

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/v1/suppressions` | filtr podle `reason`, `q`, kurzor |
| `POST` | `/api/v1/suppressions` | ruční přidání, tělo `{ email, reason: 'manual', detail? }` |
| `POST` | `/api/v1/suppressions/import` | CSV s adresami |
| `DELETE` | `/api/v1/suppressions/{id}` | odebrání podle matice v 4.10.2, tělo `{ note }` |
| `GET` | `/api/v1/suppressions/export` | CSV |
| `GET` | `/api/v1/contacts/{id}/consents` | historie |
| `POST` | `/api/v1/contacts/{id}/consents` | zápis souhlasu nebo odvolání |
| `GET` / `POST` | `/api/v1/gdpr-requests` | seznam, založení |
| `GET` | `/api/v1/gdpr-requests/{id}` | stav |
| `POST` | `/api/v1/gdpr-requests/{id}/verify` | ruční ověření správcem |
| `POST` | `/api/v1/gdpr-requests/{id}/extend` | tělo `{ reason }`, prodlouží `due_at` o 2 měsíce |
| `POST` | `/api/v1/gdpr-requests/{id}/reject` | tělo `{ reason }` |
| `GET` / `PUT` | `/api/v1/retention-policies` | čtení a nastavení, jen owner |
| `GET` | `/api/v1/retention-runs` | historie běhů |

Chyby: `403 forbidden` s `suppression_not_removable`, `409 conflict` s `suppression_too_recent` (tvrdý odraz mladší 30 dní), `403 forbidden` s `gdpr_not_verified`, `409 invalid_state_transition` u už vyřízené žádosti, `422 validation_failed` s `retention_below_minimum`.

### 5.7 Fronta ke kontrole vokativu

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/v1/vocative-review` | seskupené položky, parametry `import_id`, `kind`, `limit`, `cursor` |
| `POST` | `/api/v1/vocative-review/confirm` | tělo `{ groups: [{ name_key, gender, vocative, action, save_override }] }` |
| `GET` | `/api/v1/vocative-review/count` | jen počty, pro odznak v navigaci |
| `GET` / `POST` / `DELETE` | `/api/v1/name-overrides` | správa přepisů projektu |

```ts
type VocativeReviewGroup = {
  name_key: string;
  kind: 'first' | 'last';
  gender: 'female' | 'male' | 'unknown';
  gender_source: string;
  suggested_vocative: string | null;
  contact_count: number;
  sample_surnames: string[];
  sample_contact_id: string;
  reasons: ('gender_unknown' | 'gender_conflict' | 'LIBRARY_HEURISTIC'
          | 'AMBIGUOUS_GIVEN_NAME' | 'non_latin_script')[];
};

type VocativeReviewAction = 'confirm' | 'set_vocative' | 'set_gender' | 'no_name' | 'defer';
```

### 5.8 Formuláře a příchozí webhooky

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` / `POST` | `/api/v1/forms` | |
| `GET` / `PATCH` / `DELETE` | `/api/v1/forms/{id}` | |
| `GET` | `/api/v1/forms/{id}/embed` | tři varianty kódu k vložení |
| `GET` | `/api/v1/forms/{id}/submissions` | log odeslání |
| `GET` / `POST` | `/api/v1/inbound-endpoints` | |
| `GET` / `PATCH` / `DELETE` | `/api/v1/inbound-endpoints/{id}` | |
| `GET` | `/api/v1/inbound-endpoints/{id}/deliveries` | log, filtr podle stavu |
| `POST` | `/api/v1/inbound-endpoints/{id}/test` | přehrání uloženého doručení proti návrhu mapování, bez zápisu |
| `POST` | `/api/v1/inbound-endpoints/{id}/replay` | zpětné zpracování nezmapovaných doručení |

### 5.9 Konfigurační proměnné

Zapisují se do katalogu konfigurace v 4.9 části 1 se stejnou strukturou (název, typ, povinnost, výchozí hodnota, kterých MODE se týkají, validace). Všechny se týkají `MODE=web` a `MODE=worker`, žádná se netýká senderu. Každá podporuje variantu se sufixem `_FILE` podle konvence části 1.

| Proměnná | Typ | Povinná | Výchozí | Validace |
|---|---|---|---|---|
| `SUPPRESSION_HASH_KEY` | string | ano | žádná | min. 32 bajtů; **nesmí se měnit**, start selže, když se změní proti uloženému otisku v DB |
| `IMPORT_MAX_FILE_BYTES` | int | ne | `209715200` | 1 MB až 2 GB |
| `IMPORT_MAX_ROWS` | int | ne | `5000000` | 1 až 50 000 000 |
| `IMPORT_MAX_COLUMNS` | int | ne | `200` | 1 až 1 000 |
| `IMPORT_MAX_CELL_CHARS` | int | ne | `8192` | |
| `IMPORT_MAX_LINE_BYTES` | int | ne | `65536` | |
| `IMPORT_BATCH_SIZE` | int | ne | `1000` | 100 až 10 000 |
| `IMPORT_MAX_STORED_ERRORS` | int | ne | `10000` | |
| `IMPORT_SNIFF_BYTES` | int | ne | `262144` | |
| `IMPORT_WORKER_CONCURRENCY` | int | ne | `2` | 1 až 16 |
| `IMPORT_PREVIEW_TTL_HOURS` | int | ne | `24` | |
| `IMPORT_STALE_MINUTES` | int | ne | `10` | |
| `IMPORT_INMEMORY_DEDUP_MAX_ROWS` | int | ne | `1000000` | |
| `SEGMENT_PREVIEW_TIMEOUT_MS` | int | ne | `3000` | 500 až 30 000 |
| `SEGMENT_RECOUNT_CONCURRENCY` | int | ne | `2` | |
| `SEGMENT_MAX_CONDITIONS` | int | ne | `100` | |
| `CONTACT_FIELD_LIMIT` | int | ne | `100` | |
| `CONTACT_INDEXED_FIELD_LIMIT` | int | ne | `8` | |
| `CONTACT_SEARCH_INDEX_ENABLED` | bool | ne | `true` | při `false` se trigramový index nezakládá, ušetří zhruba 900 MB při 5 M kontaktech a zrychlí import o 15 procent, ale hledání umí jen prefix |
| `RETENTION_MIN_DAYS` | int | ne | `1` | |
| `DISPOSABLE_DOMAINS_FILE` | cesta | ne | prázdné | soubor musí existovat, jinak start selže |
| `FORM_RATE_LIMIT_PER_IP_MINUTE` | int | ne | `5` | |
| `INBOUND_MAX_BODY_BYTES` | int | ne | `1048576` | |
| `EXPORT_TTL_HOURS` | int | ne | `24` | |
| `GDPR_EXPORT_TTL_DAYS` | int | ne | `7` | |

Chybějící `SUPPRESSION_HASH_KEY` znamená, že aplikace nenastartuje a vypíše návod k jejímu vygenerování. Je to jediná povinná proměnná této části.

---

## 6. UI

### 6.1 Obrazovky

| Obrazovka | Cesta | Obsah |
|---|---|---|
| Seznam kontaktů | `/[workspace]/contacts` | tabulka, fulltext, filtry (stav, seznam, štítek, segment), hromadné akce, tlačítka Import a Export |
| Detail kontaktu | `/[workspace]/contacts/{id}` | údaje, oslovení s náhledem, seznamy, štítky, souhlasy, suppression, timeline (část 5), GDPR akce |
| Průvodce importem | `/[workspace]/contacts/import` | 5 kroků: nahrání, rozpoznání, mapování, náhled, průběh |
| Kontrola oslovení | `/[workspace]/contacts/vocative-review` | seskupené položky, hromadné potvrzení |
| Vlastní pole | `/[workspace]/settings/fields` | seznam, typy, indexace |
| Štítky | `/[workspace]/settings/tags` | |
| Seznamy | `/[workspace]/lists` a `/[workspace]/lists/{id}` | nastavení opt-in, potvrzovací šablona, statistika |
| Segmenty | `/[workspace]/segments` | seznam s počty a čerstvostí |
| Editor segmentu | `/[workspace]/segments/{id}` | vizuální query builder se živým počtem |
| Presety čištění | `/[workspace]/segments/cleanup` | šest karet s odhadem počtu a reaktivačním scénářem |
| Suppression list | `/[workspace]/suppressions` | filtr podle důvodu, přidání, odebrání |
| Formuláře | `/[workspace]/forms` a `/[workspace]/forms/{id}` | editor, náhled, kód k vložení, log odeslání |
| Příchozí webhooky | `/[workspace]/integrations/inbound` | endpointy, průvodce mapováním, log doručení |
| Souhlasy a GDPR | `/[workspace]/settings/privacy` | žádosti subjektů, retenční politiky, přehled souhlasů |
| Veřejné stránky | `/s/c/{t}`, `/u/{t}`, `/p/{t}`, `/f/{slug}` | mimo layout aplikace, vlastní minimální styl |

### 6.2 Průvodce importem, krok po kroku

| Krok | Co uživatel vidí | Prázdný stav | Načítání | Chyba |
|---|---|---|---|---|
| 1. Nahrání | drop zóna, limity, odkaz na vzorový soubor | „Přetáhněte sem CSV, nebo vyberte soubor" | ukazatel průběhu nahrávání v procentech, možnost zrušit | `file_too_large` s uvedením skutečné velikosti a limitu |
| 2. Rozpoznání | „Rozpoznali jsme: kódování windows-1250, oddělovač středník, hlavička ano" + tři rozbalovací nabídky k přepsání | neaplikuje se | kostra tabulky (skeleton) | `delimiter_not_detected` s nutností ruční volby |
| 3. Mapování | dvousloupcová tabulka „sloupec v souboru" a „kam to patří", s ukázkou první hodnoty | „Žádný sloupec se nepodařilo rozpoznat automaticky" | | `no_email_column_mapped` blokuje tlačítko Pokračovat |
| 4. Náhled | 20 řádků ve výsledné podobě, souhrn odhadů, volby chování při konfliktu, výběr seznamů a štítků, prohlášení o souhlasu | „Soubor neobsahuje žádná data" | „Počítáme odhad, může to chvíli trvat" | seznam prvních 10 chybných řádků s kódy |
| 5. Průběh | živý ukazatel z SSE, čítače, odhad zbývajícího času, tlačítko Zrušit | | „Import čeká ve frontě za importem *veletrh.csv*" | „Import selhal: nedostupné úložiště. Zkusit znovu" |
| Hotovo | souhrn, odkaz na chybné řádky, odkaz na kontrolu oslovení | | | |

### 6.3 Klíčové texty (cs a en)

Klíče jsou plné cesty v katalozích `packages/i18n/messages/{locale}.json` podle konvence 3.9 části 1: segmenty `camelCase`, zdroj pravdy je `en.json`, CI job `i18n-check` hlídá shodu množin klíčů. Počty používají ICU plurály s kategoriemi `=0`, `one`, `few`, `many`, `other`; `many` je pro desetinná čísla a musí být vyplněná.

| Klíč | cs | en |
|---|---|---|
| `contacts.list.empty` | Zatím tu nejsou žádné kontakty. Naimportujte je ze souboru nebo přidejte ručně. | No contacts yet. Import them from a file or add one manually. |
| `contacts.import.detected` | Rozpoznali jsme kódování {encoding} a oddělovač {delimiter}. | We detected {encoding} encoding and {delimiter} as the separator. |
| `contacts.import.estimate` | {new} nových, {updated} aktualizovaných, {skipped} přeskočených, {errors} chybných. | {new} new, {updated} updated, {skipped} skipped, {errors} with errors. |
| `contacts.import.doneWithErrors` | Naimportováno {count} kontaktů. {errors} řádků se nepovedlo, stáhněte si je, opravte a nahrajte znovu. | Imported {count} contacts. {errors} rows failed. Download, fix and upload them again. |
| `contacts.vocative.reviewBanner` | U {count} kontaktů si nejsme jistí oslovením. | We are not sure how to address {count} contacts. |
| `contacts.vocative.groupHint` | Jméno {name} může patřit muži i ženě. Jak ho máme oslovovat? | The name {name} can be either male or female. How should we address them? |
| `contacts.vocative.savedOverride` | Zapamatujeme si to i pro budoucí kontakty se jménem {name}. | We will remember this for future contacts named {name}. |
| `segments.stale` | Aktualizováno před {time}. | Updated {time} ago. |
| `segments.estimated` | Přibližně {count} kontaktů. Spočítat přesně | Approximately {count} contacts. Count exactly |
| `segments.notNullHint` | Kontakty, které pole vůbec nemají, sem nespadnou. Použijte podmínku „je prázdné". | Contacts that do not have this field at all are not included. Use the „is empty" condition. |
| `suppressions.complaintLocked` | Adresu, která nahlásila spam, nelze odblokovat. | An address that reported spam cannot be unblocked. |
| `suppressions.bounceTooRecent` | Tvrdý odraz jde odblokovat nejdřív po 30 dnech. Zbývá {days} dní. | A hard bounce can be unblocked after 30 days. {days} days remaining. |
| `public.unsubscribe.listScope` | Odhlašujete se ze seznamu {list}. Ostatní e-maily od nás vám budou chodit dál. | You are unsubscribing from {list}. You will still receive our other emails. |
| `public.unsubscribe.global` | Nechci od vás už nic | Unsubscribe from everything |
| `public.unsubscribe.done` | Hotovo, už vám nic nepošleme. | Done, we will not email you again. |
| `public.preferences.masked` | Nastavení pro {maskedEmail} | Preferences for {maskedEmail} |
| `privacy.gdpr.exportReady` | Vaše data jsou připravená ke stažení. Odkaz platí 7 dní. | Your data is ready to download. The link is valid for 7 days. |
| `privacy.gdpr.eraseConfirm` | Opravdu smazat všechny údaje tohoto kontaktu? Nejde to vrátit. | Really erase all data for this contact? This cannot be undone. |
| `forms.droppedSilently` | (žádný text, botovi se vrací úspěch) | |
| `segments.cleanup.warning` | Za {days} dní odhlásíme {count} kontaktů. | In {days} days we will unsubscribe {count} contacts. |

### 6.4 Query builder segmentů

Vizuální, ne textový. Struktura odpovídá AST jedna ku jedné: skupina je rámeček s přepínačem `A zároveň` / `Nebo`, podmínka je řádek se třemi prvky (pole, operátor, hodnota).

- Nabídka polí je seskupená: Kontakt, Vlastní pole, Štítky, Seznamy, Souhlasy, Aktivita v kampaních, Chování na webu, Jiný segment.
- Operátory se nabízejí podle typu pole, nekompatibilní se vůbec nezobrazí. Uživatel tedy nemůže sestavit neplatný AST.
- Počet se aktualizuje 500 ms po poslední změně, dokud se počítá, zobrazuje se předchozí hodnota zešedlá s otáčejícím se indikátorem.
- U podmínky nad neindexovaným vlastním polem je vedle názvu ikona s vysvětlením.
- Nad builderem je přepínač na zobrazení JSON pro pokročilé, ve dvou režimech: jen čtení, nebo úprava s validací proti schématu.
- Prázdný stav: „Segment zatím nemá žádnou podmínku, obsahuje tedy všechny kontakty ({count})."

### 6.5 Přístupnost a chování bez JavaScriptu

Veřejné stránky (potvrzení, odhlášení, preference, formuláře) fungují **bez JavaScriptu**: obyčejné formuláře s `POST` a `303`. Je to podmínka, ne bonus, protože se otevírají z poštovních klientů a v prohlížečích s přísným blokováním.

Administrace JavaScript vyžaduje. Všechny tabulky mají klávesovou navigaci, hromadné akce mají potvrzovací dialog s uvedením konkrétního počtu dotčených kontaktů a všechny nevratné akce (výmaz, hromadné odhlášení, odebrání ze suppression listu) vyžadují druhé potvrzení.

---

## 7. Bezpečnost a soukromí

### 7.1 Izolace projektů

Platí dvouvrstvý model z 3.6 části 1: repository vrstva s branded `WorkspaceContext` a nad ní row-level security s politikou `ws_isolation`. Všechny tabulky této části mají sloupec `workspace_id`, takže **všechny** mají RLS zapnuté; žádná není na whitelistu výjimek v `packages/db/src/rls.ts`.

Repository moduly této části registrované do `isolation.matrix.test.ts` části 1: `contacts`, `lists`, `segments`, `suppressions`, `consents`, `imports`, `forms`, `inbound`. Generický test cizího kontextu je tím pokrytý a tato část nepíše vlastní izolační testy, jen ty tři níže, které generický test nepokrývá:

1. **Kompilátor segmentů.** `workspace_id = $1` přidává kompilátor, ne volající, a RLS to jistí potřetí. Testy: pokus zkompilovat AST s `list_id` z cizího projektu musí skončit `segment_reference_not_found` (ne prázdným výsledkem), a spuštění zkompilovaného SQL bez `set_config('openengage.workspace_id')` musí vrátit nula řádků.
2. **Veřejné endpointy s tokenem.** `/s/c/`, `/u/`, `/p/`, `/r/` nemají session, projekt se bere výhradně z ověřeného tokenu. Test: token vydaný pro projekt A nesmí zasáhnout data projektu B.
3. **Veřejné endpointy se slugem.** `/f/{slug}` a `/api/v1/inbound/{slug}` hledají podle globálně unikátního slugu. Projekt se odvodí z nalezeného záznamu, nikdy z parametru požadavku.

### 7.2 Tajemství a jejich uložení

| Tajemství | Uložení |
|---|---|
| Potvrzovací token přihlášení | jen SHA-256 v DB, syrový jen v e-mailu |
| Odhlašovací a preferenční token | neukládá se vůbec, je podepsaný a bezstavový |
| Token ke stažení exportu | jen SHA-256 |
| Tajemství příchozího webhooku | AES-256-GCM, klíč z `SECRET_KEY` přes HKDF |
| Otisk e-mailu pro suppression | HMAC-SHA256 s `SUPPRESSION_HASH_KEY` |
| Nonce formuláře | HMAC, neukládá se |

Všechna porovnání tajemství jsou v konstantním čase (`crypto.timingSafeEqual`).

### 7.3 Enumerace a únik informací

- Veřejné stránky vracejí u neplatného tokenu **200 se stejnou stránkou** jako u platného-ale-neexistujícího, nikdy 404.
- `POST /f/{slug}/submit` vrací úspěch i pro adresu na suppression listu.
- Stránka preferencí zobrazuje adresu maskovanou (`j***@example.cz`).
- Chyby API u cizích ID vracejí `404`, ne `403`.
- `POST /api/v1/contacts/lookup` je POST právě proto, aby se e-mailová adresa neobjevila v URL, v access logu ani v historii prohlížeče.

### 7.4 Rate limity

| Endpoint | Limit |
|---|---|
| `/f/{slug}/submit` | 5 za minutu na IP, 30 za hodinu na IP, 100 za minutu na formulář |
| `GET /s/c/{token}`, `GET|POST /p/{token}` | 30 za minutu na IP, 60 za hodinu na token |
| **`POST /u/{token}` (one-click)** | **jen 20 za hodinu na token, žádný limit na IP** |
| `GET /u/{token}` | 30 za minutu na IP |
| `/api/v1/inbound/{slug}` | 100 za sekundu na endpoint, burst 500 |
| `/api/v1/segments/preview` | 20 za minutu na uživatele |
| `POST /api/v1/contacts/imports` | 10 za hodinu na projekt |
| `POST /api/v1/contacts/exports` | 10 za hodinu na projekt |
| Potvrzovací e-mail (resend) | min 5 minut mezi e-maily, max 3 za 24 h na kontakt a seznam |

### 7.5 Audit log

Zapisují se: `contact.created`, `contact.updated`, `contact.deleted`, `contact.anonymized`, `contact.purged`, `contact.email_changed`, `contact.bulk_deleted`, `contact.vocative_lock_released`, `contact.vocative_bulk_confirmed`, `field.created`, `field.deleted`, `field.indexed`, `list.created`, `list.opt_in_changed`, `subscription.forced_confirmed`, `suppression.added`, `suppression.removed`, `segment.created`, `segment.deleted`, `segment.frozen`, `import.confirmed`, `import.cancelled`, `export.created`, `export.downloaded`, `form.double_opt_in_disabled`, `inbound.mapping_changed`, `gdpr.request_created`, `gdpr.request_completed`, `gdpr.request_rejected`, `retention.policy_changed`, `retention.run_completed`, `name_override.created`.

U `contact.anonymized` a `contact.purged` se do metadat **neukládá e-mail**, jen otisk.

### 7.6 Ochrana proti CSV injection

Každá buňka exportu, která začíná na `=`, `+`, `-`, `@`, tabulátor nebo `\r`, dostane prefix `'`. Bez toho by kontakt se jménem `=HYPERLINK("http://zlo.cz","klikni")` znamenal spuštění kódu v tabulkovém procesoru toho, kdo export otevře. Platí i pro `errors.csv` a pro GDPR export.

### 7.7 Zpracování nahraného souboru

- Soubor se ukládá mimo webroot, jméno je odvozené z `import_id`, ne z uživatelského jména souboru.
- Původní jméno se ukládá jen jako metadata a při zobrazení se escapuje.
- Content type se ignoruje, rozhoduje obsah.
- Nekontroluje se přípona, ale nahrání souboru, který není textový (binární nuly v prvních 8 kB), skončí `unsupported_encoding`.
- Soubor se maže podle retenční politiky, nejpozději za 30 dní.

---

## 8. Výkon

### 8.1 Cílové objemy

| Veličina | Cíl MVP 0 | Strop návrhu |
|---|---|---|
| Kontaktů v projektu | 100 000 | 5 000 000 |
| Vlastních polí | 20 | 100 |
| Seznamů | 10 | 500 |
| Segmentů | 20 | 500 |
| Štítků | 50 | 500 |
| Řádků v importu | 100 000 | 5 000 000 |

### 8.2 Kritické dotazy a jejich krytí

| Dotaz | Cíl při 5 M kontaktech | Index |
|---|---|---|
| Vyhledání kontaktu podle e-mailu | < 2 ms | `uq_contacts__workspace_email` |
| První stránka seznamu kontaktů | < 50 ms | `idx_contacts__ws_created` |
| Stránkování hluboko v seznamu (keyset) | < 50 ms | tentýž, keyset nikoliv OFFSET |
| Fulltext podle jména nebo části adresy | < 300 ms | `idx_contacts__search_trgm` |
| Kontrola suppression pro jednu adresu | < 2 ms | `uq_suppressions__workspace_email` |
| Kontrola suppression pro dávku 1 000 adres | < 30 ms | tentýž, přes `= ANY(...)` |
| Fronta ke kontrole vokativu, seskupená | < 500 ms | `idx_contacts__ws_vocative_review` |
| Segment jen nad prvotřídními poli, `count(*)` | 1 až 3 s | částečné indexy, paralelní scan |
| Segment nad neindexovaným vlastním polem | 4 až 10 s | seq scan, proto odhad místo přesného počtu |
| Segment s podmínkou na štítek | < 1 s | `idx_contact_tags__tag` |
| Segment s podmínkou na seznam | < 1 s | `idx_list_subscriptions__list_status` |
| Segment s engagement přes rollup | 1 až 3 s | `contact_engagement` (část 5) |
| Segment s engagement přes `message_events` | 30 s a víc | proto varování a preferovaný rollup |

Stránkování je **vždy keyset**, nikdy `OFFSET`. `OFFSET 4900000` znamená přečíst 4,9 milionu řádků, aby se zahodily.

### 8.3 Import

Rozpočet na jeden řádek při dávce 1 000:

| Fáze | Odhad na řádek |
|---|---|
| Dekódování a parsování CSV | 3 µs |
| Normalizace a validace e-mailu | 2 µs |
| Rozdělení jména, rod, vokativ, oslovení | **0,72 µs změřeno** plus zhruba 2 µs na slovníky a jistotu |
| Koerce vlastních polí (12 polí) | 8 µs |
| Sestavení dávky | 5 µs |
| Zápis do databáze (amortizovaně) | 300 až 700 µs |

Databázový zápis je dominantní o dva řády. **Česká morfologie není a nebude úzké hrdlo.** Cílová propustnost je 1 000 až 3 000 řádků za sekundu na běžném čtyřjádrovém stroji, tedy 100 000 řádků do dvou minut a 5 000 000 do 30 až 90 minut podle počtu indexů a vlastních polí.

Co propustnost snižuje, v pořadí podle dopadu: počet indexovaných vlastních polí, GIN index nad `attributes` (dá se dočasně vypnout přes `SET LOCAL gin_pending_list_limit`), počet seznamů, do kterých se přihlašuje, a zapnutá kontrola duplicit v paměti u velmi velkých souborů.

### 8.4 Kde to praskne dřív

1. **Engagement podmínky v segmentech bez rollup tabulky.** `EXISTS` nad `message_events` s desítkami milionů řádků je desítky sekund. Proto je rollup od části 5 tvrdý požadavek, ne přání.
2. **GIN index nad `attributes` při rychlém zápisu.** Import 5 milionů kontaktů nafoukne pending list a autovacuum ho pak dohání. Mitigace: po velkém importu se spustí `VACUUM ANALYZE contacts` jako součást dokončení importu.
3. **`count(*)` u segmentů s `OR` přes víc `EXISTS`.** Plánovač si často vybere seq scan. Odtud pochází mechanismus odhadu z 4.11.5.
4. **Trigram index nad `search_text`** je největší index tabulky. U projektů, kde se nehledá, jde vypnout přepínačem `CONTACT_SEARCH_INDEX_ENABLED`, čímž se ušetří 900 MB a zrychlí import zhruba o 15 procent.
5. **Fronta ke kontrole vokativu u importu s převahou cizích jmen.** Když se do `low` dostane 40 procent z pěti milionů, seskupený dotaz vrátí statisíce skupin. Proto má fronta strop: nad 5 000 skupin se zobrazí jen prvních 5 000 podle četnosti a nabídne se hromadná akce „u zbytku nepoužívat jméno".

---

## 9. Akceptační kritéria

### 9.1 Import

1. Soubor z českého Excelu v CP1250 se středníkem a diakritikou se naimportuje bez poškození znaků. Kontrola: kontakt s příjmením `Šťastná` má v databázi přesně `Šťastná`.
2. Soubor v UTF-8 s BOM se naimportuje bez toho, aby první sloupec hlavičky obsahoval neviditelné znaky.
3. Soubor v ISO-8859-2 se rozpozná jako ISO-8859-2, ne jako ISO-8859-1.
4. Soubor s 10 chybnými řádky z 1 000 skončí jako `completed_with_errors`, naimportuje 990 kontaktů a nabídne 10 řádků ke stažení ve stejném kódování a se stejným oddělovačem jako originál.
5. Nahrání téhož souboru se stejným mapováním podruhé do 24 hodin vrátí `409 conflict` s `import_duplicate` a s ID původního importu.
6. Nahrání téhož souboru s **jiným** mapováním založí nový import bez ptaní.
7. Zabití workeru uprostřed importu 100 000 řádků a jeho restart nezpůsobí ani jednu duplicitu ani jeden vynechaný řádek. Kontrola: počet kontaktů po obnově odpovídá počtu unikátních adres v souboru.
8. Import adresy, která je na suppression listu s důvodem `complaint`, kontakt nevytvoří a započítá se jako `suppressed_rows`.
9. Import s `on_conflict = 'update'` nepřepíše vlastní pole, které v souboru není namapované.
10. Import nikdy nezmění stav kontaktu z `unsubscribed` na `active`.
11. Náhled ukáže u řádku „Ing. Pavel Novák" titul `Ing.`, jméno `Pavel`, příjmení `Novák` a oslovení `Dobrý den, Pavle` ještě před potvrzením.
12. Zrušení importu uprostřed nechá zapsané kontakty a stav bude `cancelled` s uvedením řádku, na kterém se skončilo.

### 9.2 Jména, rod a vokativ

13. Sloupec `Jméno a příjmení` s hodnotou `Jana Nováková` vyrobí `first_name = 'Jana'`, `last_name = 'Nováková'`, `gender = 'female'`, `first_name_vocative = 'Jano'`, `greeting = 'Dobrý den, Jano'`.
14. Hodnota `Nováková Jana` vyrobí totéž, protože příjmení na `-ová` v první pozici a známé křestní jméno v druhé znamenají obrácené pořadí.
15. Hodnota `Nováková, Jana` vyrobí totéž díky čárce.
16. Hodnota `Petr Novák` vyrobí `Dobrý den, Petře`.
17. Hodnota `Nikola Krátký` skončí s `gender = 'unknown'`, `vocative_confidence = 'low'` a objeví se ve frontě ke kontrole.
18. Hodnota `Иван Петров` neprodukuje žádný vokativ a `greeting` je `Dobrý den`.
19. Prázdné jméno produkuje `greeting = 'Dobrý den'`, **nikdy** `Dobrý den, ` s visící čárkou. Test projde všech 8 kombinací prázdnosti `first_name`, `last_name`, `gender`.
20. Vokativ se **nikdy** nepočítá s vynuceným mužským rodem u příjmení končícího na `-ová`. Regresní test: `Nováková` nesmí nikdy vyprodukovat `Novákováe`.
21. Potvrzení skupiny ve frontě ke kontrole nastaví u všech kontaktů skupiny `vocative_locked = true` a `vocative_confidence = 'high'` a při zaškrtnutém „uložit pro budoucí" vznikne řádek v `name_overrides`.
22. Po vytvoření přepisu pro jméno `Nikola` (žena) další import s tímtéž jménem už do fronty nepadne.
23. Změna `first_name` u kontaktu se zamknutým vokativem zámek uvolní, přepočítá vokativ a vrátí kontakt do fronty. Změna jen `gender` zámek nechá.
24. Změna `workspaces.address_form` z `formal` na `informal` přepočítá `greeting` i `greeting_neutral` u všech kontaktů projektu.
24b. `greeting_neutral` nikdy neobsahuje jméno ani příjmení kontaktu. Test projde všech 143 kontaktů z fixture a hledá v `greeting_neutral` podřetězec `first_name` a `last_name`.
24c. Počet kontaktů, u kterých se `greeting` a `greeting_neutral` liší, se rovná počtu, který dialog ve 4.5.4 ukazuje jako „u N kontaktů si nejsme jistí oslovením".

### 9.3 Segmenty

25. AST s operátorem, který k typu pole nepatří, skončí `422 validation_failed` s `segment_operator_not_allowed` a nikdy nedojde ke spuštění SQL.
26. AST odkazující na `list_id` z cizího projektu skončí `404 not_found` s `segment_reference_not_found`, ne prázdným výsledkem. Zkompilované SQL spuštěné bez `set_config('openengage.workspace_id')` vrátí nula řádků.
27. Hodnota `'; DROP TABLE contacts; --` v poli `value` neovlivní strukturu dotazu. Test kontroluje, že vygenerovaný SQL text obsahuje `$n` a neobsahuje uživatelský řetězec.
28. Klíč vlastního pole se ve vygenerovaném SQL objeví jako parametr, nikdy jako literál.
29. Zkompilovaný dotaz vždy obsahuje `workspace_id = $1`, `deleted_at IS NULL` a `processing_restricted = false`, i když je AST prázdný.
30. Vlastní pole typu `number`, ve kterém má jeden kontakt textovou hodnotu, nezpůsobí selhání dotazu s operátorem `gt`.
31. Náhled, který překročí 3 sekundy, vrátí `exact: false` s odhadem, ne chybu.
32. Cyklus `A → B → A` v odkazech na segmenty nejde uložit.
33. AST se 101 podmínkami skončí `segment_too_complex`.
34. Segment `NOT (city = 'Praha')` nevrátí kontakty, které pole `city` vůbec nemají.
35. **Vygenerované SQL neobsahuje `now(`, `current_timestamp`, `localtimestamp` ani `current_date`.** Test kontroluje text dotazu, ne chování, pro všech 60 kombinací pole a operátoru.
36. Dvě volání `compileAudienceToSql` se stejným `asOf` a stejným AST vrátí bajtově shodné `sql` i `params`.
37. `compileAudienceToSql` s `paramOffset: 5` vrátí SQL, jehož nejnižší parametr je `$6`, a `params` odpovídající délky.
38. `compileAudienceToSql` s `alias: 'x'` vrátí SQL, které nikde neobsahuje samostatné `c.`.
39. Vygenerovaná obálka **vždy** obsahuje `deleted_at IS NULL`, `processing_restricted = false` a `NOT EXISTS` nad `suppressions` s `removed_at IS NULL`, i když je AST prázdný a i když se skládá jen ze `listIds`.
40. Publikum ze seznamu neobsahuje kontakt se `status = 'pending'` na tom seznamu ani kontakt se `snooze_until` v budoucnosti vůči `asOf`.
41. `compileAudienceToSql` s prázdným `audience` skončí `422 validation_failed` s `audience_empty`, nikdy nevrátí SQL bez podmínky publika.
42. Kontakt se `contacts.status = 'active'`, který nemá na cílovém seznamu `confirmed`, se do publika nedostane.

### 9.4 Double opt-in a odhlášení

35. Přihlášení na seznam s `opt_in = 'double'` vytvoří `pending` a odešle potvrzovací e-mail. Kontakt se **neobjeví** v publiku kampaně mířené na tento seznam.
36. Kliknutí na potvrzovací odkaz v dvoukrokovém režimu jen zobrazí stránku; teprve odeslání formuláře změní stav na `confirmed`.
37. Opakované kliknutí na už použitý odkaz zobrazí „už jste přihlášeni" a vrátí 200, nikdy chybu.
38. Prošlý odkaz nabídne odeslání nového a odešle ho, pokud nebyl vyčerpán limit tří pokusů za 24 hodin.
39. Přihlášení dříve odhlášeného kontaktu na seznam se `single` opt-in vytvoří **`pending`**, ne `confirmed`.
40. Přihlášení kontaktu na suppression listu s důvodem `complaint` skončí `409 conflict` s `subscribe_blocked_complaint`.
41. `POST /u/{token}` s tělem `List-Unsubscribe=One-Click` vrátí `200`, **ne** přesměrování, a odhlásí kontakt.
42. `GET /u/{token}` nikoho neodhlásí a zobrazí stránku s preferencemi.
43. Odhlašovací token bez `list_id` vytvoří `suppressions(global_unsubscribe)`, s `list_id` nikoliv.
44. Odhlášení během běžící kampaně nastaví všechny `messages` daného kontaktu ve stavu `pending` na `skipped` a nedotkne se řádků ve stavu `claimed`.
45. Odhlašovací odkaz z e-mailu odeslaného před rotací `SECRET_KEY` funguje i po rotaci.

### 9.5 Suppression, souhlasy, GDPR

46. Suppression s důvodem `complaint` nejde odebrat žádným endpointem, ani vlastníkem projektu.
47. Suppression s důvodem `hard_bounce` mladší 30 dní vrátí `409 conflict` s `suppression_too_recent`.
48. Odhlášený kontakt, který znovu projde double opt-in, má suppression s důvodem `global_unsubscribe` automaticky odebranou.
49. Každý zápis souhlasu vytvoří nový řádek v `consents`; žádný endpoint existující řádek nemění ani nemaže.
50. Export dat subjektu obsahuje všech deset souborů a je stažitelný jednorázovým odkazem s platností 7 dní.
51. `due_at` u nové žádosti je přesně jeden měsíc od `requested_at`; prodloužení přidá dva měsíce a vyžaduje důvod.
52. Anonymizace kontaktu vyprázdní jméno, e-mail i `attributes`, smaže souhlasy a přihlášení, a **nezmění** počet otevření u žádné kampaně, které se kontakt účastnil.
53. Po anonymizaci vznikne suppression s důvodem `gdpr_erasure` a otiskem původní adresy.
54. Import souboru obsahujícího adresu dříve vymazanou podle GDPR kontakt nevytvoří.
55. Kontakt s `processing_restricted = true` nespadne do žádného segmentu.
56. Retenční běh nikdy nesmaže řádek z `consents` ani ze `suppressions`.
57. `suppressions.add` volaná dvakrát se stejným e-mailem a důvodem vytvoří jeden řádek, podruhé vrátí `created: false` a stejné `suppressionId`.
58. `suppressions.add` s `reason = 'complaint'` nastaví **všechny** řádky `list_subscriptions` daného kontaktu na `complained`, `contacts.status` na `complained` a zapíše `consents` se `status = 'withdrawn'`, to vše v jedné transakci.
59. `suppressions.add` s `reason = 'hard_bounce'` na adresu, která je už blokovaná kvůli `complaint`, důvod **nepřepíše** a přidá záznam do `metadata`.
60. `suppressions.add` s `reason = 'ses_suppressed'` projde CHECK omezením a nastaví `contacts.status = 'bounced'`.
61. Odblokovaná adresa (`removed_at` vyplněné) se znovu dostane do publika kampaně. Regresní test proti chybějícímu `removed_at IS NULL`.
62. Adresa vymazaná podle čl. 17 se do publika nedostane ani tehdy, když v `suppressions.email` je placeholder. Test jde přes větev `email_hash`.
63. Odhlášení ze seznamu A zavolá `revokePendingMessages` s `listId = A` a **nezruší** čekající zprávu kampaně mířené na seznam B.
64. Smazání vlastního pole, které používá naplánovaná kampaň, skončí `409 conflict` s `field_used_by_scheduled_campaign`.
65. Smazání vlastního pole zařadí job `content.revalidate_templates` části 3, ne jen `segments.mark_invalid`.
66. `POST /u/{token}` volaný 200krát za minutu z jedné IP s různými tokeny **nevrátí ani jednou `429`**.

### 9.6 Formuláře a příchozí webhooky

67. Formulář vložený čistým HTML funguje s vypnutým JavaScriptem a po odeslání přesměruje na děkovací stránku.
68. Odeslání s vyplněným honeypotem vrátí stejnou úspěšnou odpověď jako platné odeslání a nezaloží kontakt.
69. Odeslání dřív než 2 sekundy po vydání nonce se tiše zahodí.
70. Odeslání z domény mimo `allowed_origins` skončí `403`.
71. Formulář nemůže zapsat do klíče, který neexistuje v `contact_fields`.
72. Odeslání adresy na suppression listu vrátí úspěch a nic nezapíše.
73. Příchozí webhook s neplatným podpisem vrátí `401` a nic nezapíše.
74. Dvojí doručení téhož `external_id` vytvoří jen jeden kontakt a druhá odpověď obsahuje `duplicate: true`.
75. Doručení s neznámým tvarem payloadu se uloží jako `unmapped` a je vidět v průvodci mapováním.
76. `POST /inbound-endpoints/{id}/test` nezmění žádná data a vrátí náhled výsledného kontaktu.

---

## 10. Závislosti

Všechny ověřené 2026-07-31 příkazy `npm view <balíček> license version time.modified` a `curl -s https://api.npmjs.org/downloads/point/last-week/<balíček>`.

### 10.1 Nové závislosti, které tato část přidává

| Balíček | Verze | Licence | Poslední změna | Stažení za týden | K čemu |
|---|---|---|---|---|---|
| `czech-vocative` | 2.1.0 | MIT | 2026-03-29 | 6 795 | Český vokativ a příponová detekce rodu. Ověřené chování v 4.4.5 |
| `csv-parse` | 7.0.1 | MIT | 2026-07-02 | 17 765 531 | Proudové parsování CSV s podporou pozice ve streamu, kterou potřebujeme pro `checkpoint_byte` |
| `csv-stringify` | 6.8.1 | MIT | 2026-07-02 | 9 368 825 | Generování exportů a `errors.csv` |
| `iconv-lite` | 0.7.3 | MIT | 2026-07-17 | 275 504 261 | Dekódování `windows-1250` a `ISO-8859-2`, kódování exportu |

Čtyři balíčky, všechny permisivní, žádný konflikt s MIT distribucí.

### 10.2 Volitelné, ne v MVP 0

| Balíček | Verze | Licence | Poslední změna | Stažení za týden | Kdy |
|---|---|---|---|---|---|
| `libphonenumber-js` | 1.13.10 | MIT | 2026-07-30 | 22 784 443 | Normalizace telefonů na E.164 u pole typu `phone`. Bez ní se telefon ukládá tak, jak přišel |

### 10.3 Zvažované a zamítnuté

| Balíček | Verze | Licence | Důvod zamítnutí |
|---|---|---|---|
| `czech-inflection` | 1.1.1 | **LGPL v2.1** | Licenční konflikt s MIT distribucí. V JavaScriptu se knihovna bundluje, takže argument o dynamickém linkování neobstojí. Navíc poslední změna 2022-04-28. Toto je konkrétní úlovek licenční brány z kapitoly 9 hlavní specifikace |
| `jschardet` | 3.1.4 | **LGPL-2.1+** | Licenční konflikt. Nesmí se použít ani na detekci kódování |
| `chardet` | 2.2.0 | MIT | Licenčně v pořádku, ale **funkčně nevyhovuje**: vrací `windows-1252` pro skutečná data v CP1250, viz měření v 4.6.2. Nahrazeno vlastním skórováním podle českých písmen, které nepotřebuje žádnou závislost |
| `vokativ` | 1.0.1 | MIT | Předchůdce `czech-vocative` se stejným algoritmem, méně stažení, bez aktualizace od 2023-05-10 |
| `papaparse` | 5.5.4 | MIT | Dobrá knihovna (14 M stažení týdně), ale `csv-parse` má lepší podporu proudového zpracování s přesnou pozicí ve vstupu, což potřebujeme pro obnovu importu po pádu |
| `jsonpath-plus` | 10.4.0 | MIT | Pro mapování příchozích webhooků je zbytečně mocná. Naše gramatika je záměrně jen `$`, `.klíč` a `[n]`, což je 40 řádků kódu bez závislosti a bez rizika, že někdo pošle výraz s vedlejším účinkem |
| Turnstile, hCaptcha | | | Nejsou npm závislost, jen HTTP volání. Ve výchozím stavu vypnuté, protože posílají data návštěvníků třetí straně |

### 10.4 Vlastní datové soubory

| Soubor | Obsah | Zdroj | Poznámka |
|---|---|---|---|
| `given-names.json` | 4 000 až 6 000 českých a slovenských křestních jmen s rodem a příznakem obourodosti | k dohledání, viz otevřená otázka O5 | Licence zdroje se musí ověřit před zařazením a uvést v `NOTICE`. Modul funguje i bez tohoto souboru, jen s vyšším podílem `low` |
| `titles.json` | prefixové a sufixové akademické tituly | vlastní, sestavený z 4.4.2 | |
| `vietnamese-surnames.json` | 15 nejčastějších vietnamských příjmení | vlastní | |
| `disposable-domains.txt` | volitelný seznam jednorázových domén | volitelný, dodá provozovatel | Není součástí image |

---

## 11. Požadavky na ostatní části

### 11.1 Na část 1 (platforma)

| # | Požadavek | Proč | Tvar |
|---|---|---|---|
| 1.1 | Rozšíření **`pg_trgm`** v migraci jádra | Fulltextové hledání kontaktu podle části jména nebo adresy. Bez něj by hledání „nov" nad 5 miliony řádků znamenalo seq scan | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` |
| 1.2 | Rozšíření **`btree_gin`** | Aby šlo `workspace_id` (uuid) do stejného GIN indexu jako trigramy a hledání nikdy neprocházelo cizí projekty. `btree_gin` podporuje `uuid` od PostgreSQL 13 | `CREATE EXTENSION IF NOT EXISTS btree_gin;` |
| 1.3 | Náhradní řešení, pokud 1.1 nebo 1.2 neprojde | Hledání se omezí na prefix (`email LIKE 'nov%'`) nad běžným btree indexem `(workspace_id, email text_pattern_ops)`. Ztratí se hledání uprostřed řetězce, což je citelné zhoršení UX | rozhodnutí části 1 |
| 1.4 | Proměnná **`SUPPRESSION_HASH_KEY`** v katalogu konfigurace, označená jako **nerotovatelná** | Otisk vymazané adresy musí přežít rotaci `SECRET_KEY`, jinak se smazaní lidé vrátí prvním importem. Odvození z `SECRET_KEY` přes HKDF **nestačí**, protože rotace by otisky zneplatnila | povinná, min. 32 bajtů, validace při startu, uložení otisku klíče do `system_settings` jako u `secret_key_fingerprint` |
| 1.5 | Potvrzení, že `SECRET_KEY_PREVIOUS` se u odhlašovacích tokenů **nikdy neodebírá** | Odhlašovací odkaz nesmí přestat fungovat. Nefunkční odkaz je porušení čl. 7 odst. 3 GDPR a přímá cesta ke stížnosti na spam | doplnit do tabulky dopadů rotace v 3.10 části 1 řádek pro odhlašovací tokeny, se stejným pravidlem jako u trackovacích |
| 1.6 | **Read-only connection pool** (`default_transaction_read_only = on`) | Náhled segmentu spouští dynamicky sestavené SQL. Chyba v kompilátoru nesmí mít možnost zapsat | pojmenovaný pool, například `dbReadOnly` |
| 1.7 | Možnost nastavit **`statement_timeout` per dotaz** | Náhled segmentu má tvrdý strop 3 s a spoléhá na `57014 query_canceled` | `SET LOCAL statement_timeout` uvnitř transakce |
| 1.8 | Role s právem obejít append-only na `consents` | Výmaz podle čl. 17 musí souhlasy smazat, běžná aplikační role na to nemá právo | `openengage_gdpr` s `DELETE ON consents`, používaná jen jobem `gdpr.erase` |
| 1.9 | Odchozí webhookové události z 4.14.7 v katalogu událostí | | seznam v 4.14.7 |
| 1.10 | Role a oprávnění: **vlastník** pro hromadné mazání kontaktů, nastavení retence a režim `purge`; **admin** pro odebrání tvrdého odrazu ze suppression listu | Nevratné operace nad daty, která uživatel roky sbíral | doplnit do matice oprávnění |
| 1.11 | SSE kanál pro průběh dlouhých jobů | Průběh importu a hromadných operací | `GET /api/v1/.../events` |
| 1.12 | Potvrzení mapování `workspaces.address_form` na oslovení podle 3.12 | Aby nevznikla dvě konkurenční nastavení téhož | tabulka kombinací v 3.12 |
| 1.13 | Doplnit **`/s/c/**`, `/p/**`, `/r/**`** mezi veřejné cesty v 4.1 | Konvence 4.1 části 1 vyjmenovává jen `/t/**`, `/e/**`, `/u/**`, `/f/**`. Bez doplnění by potvrzení přihlášení, stránka preferencí a reaktivační odkaz spadly pod CSRF a session middleware, což je zablokuje | tři řádky v tabulce povrchů; autentizace „podepsaný token", CSRF „ne" |
| 1.14 | Doplnit **`inbound_deliveries`** do seznamu partitionovaných tabulek obsluhovaných jobem `platform.maintain_partitions` | Jinak se pro ni nezaloží partition a zápis selže, protože `DEFAULT` partition se podle konvence nezakládá | jeden řádek v 2.1 |
| 1.15 | Výjimka z pravidla „repository funkce nepřijímá řetězec" pro kompilátor segmentů | AST je uživatelský vstup, který se musí dostat do repository vrstvy. Obrana je popsaná ve 4.11.3 a stojí na uzavřených výčtech, konstantní mapě sloupců a parametrech, ne na typu argumentu | povolit `packages/db/src/repo/segments.ts` jako jediné místo s dynamickým SQL, plus ESLint výjimka |
| 1.16 | Potvrdit, že limit těla JSON 1 MiB se **nevztahuje** na `PATCH /contacts/imports/{id}` s velkým mapováním | Mapování 200 sloupců plus volby se do 1 MiB vejde s rezervou, jde jen o potvrzení, že se limit počítá per endpoint a ne globálně | |

### 11.2 Na část 3 (obsah a šablony)

| # | Požadavek | Tvar |
|---|---|---|
| 3.1 | Merge tagy odpovídající polím kontaktu | `{{ contact.email }}`, `{{ contact.first_name }}`, `{{ contact.last_name }}`, `{{ contact.first_name_vocative }}`, `{{ contact.last_name_vocative }}`, `{{ contact.greeting }}`, `{{ contact.title_prefix }}`, `{{ contact.locale }}`, `{{ contact.attr.<key> }}` pro vlastní pole |
| 3.2 | `{{ contact.greeting }}` je **hotový řetězec**, ne funkce. Šablona ho nesmí nijak upravovat ani skládat s dalším textem před čárkou | |
| 3.3 | Filtr `\| vocative` **neexistuje**. Validátor na `{{ contact.first_name \| vocative }}` vrátí chybu s nápovědou „použijte `{{ contact.first_name_vocative }}`" | dohodnuto v kapitole 6.3 hlavní specifikace |
| 3.4 | Validátor konzumuje **`getFieldCatalog(ctx)`** z 4.2.3, ne REST endpoint. Vrací `{ fields: [{ path, type, label: {cs,en}, group, itemType?, deleted }], version }` | signatura a mapování typů ve 4.2.3 |
| 3.7 | **`findTemplatesUsingField(ctx, path)`** a job **`content.revalidate_templates`**. Volám je při kontrole dopadu a při smazání vlastního pole, viz 4.2.5 | `findTemplatesUsingField` vrací `{ id, name, usages }[]` |
| 3.5 | Šablony potvrzovacího e-mailu, uvítacího e-mailu a reaktivační kampaně jako součást produktu, ne jako příklad | tři systémové šablony, `kind = 'system'` |
| 3.6 | Tokeny `{{ unsubscribe_url }}`, `{{ preferences_url }}` a `{{ confirmation_url }}` musí být v katalogu merge tagů | hodnoty dodává část 4 při interpolaci |

### 11.3 Na část 4 (kampaně a sender)

| # | Požadavek | Proč |
|---|---|---|
| 4.1 | Materializace publika **musí** kontrolovat suppression list přes dotaz z 4.10.3 (obě větve, `email` i `email_hash`), ne přes `contacts.status` | `contacts.status` je odvozený údaj pro zobrazení, autoritativní je `suppressions` |
| 4.2 | Materializace **musí** vyloučit `contacts.processing_restricted = true` a `contacts.deleted_at IS NOT NULL` | čl. 18 GDPR |
| 4.3 | Materializace **musí** vyloučit `list_subscriptions.snooze_until > now()` | pozastavení odběru ze stránky preferencí |
| 4.4 | Materializace **musí** brát jen `list_subscriptions.status = 'confirmed'`, nikdy `pending` | jádro double opt-in |
| 4.5 | **Funkce `revokePendingMessages(ctx, { contactId, listId, reason })`** s povinným parametrem `listId`. Dnes v části 4a chybí. Bez `listId` by odhlášení z jednoho newsletteru zrušilo veškerou čekající poštu toho člověka včetně kampaní na jiné seznamy, což je tichá ztráta pošty | signatura ve 4.9.4; přechod jen `pending → skipped`, z `claimed` zakázaný; zápis do kontraktního `error_code`, ne do neexistujícího `error` |
| 4.5b | Materializace publika **musí** volat `compileAudienceToSql` z 4.11.3 a nesmí psát vlastní SQL nad `contacts`, `list_subscriptions` ani `suppressions` | důvod je v 4.11.3: obálka nese pět doménových podmínek části 2, jejichž vynechání pošle poštu člověku s omezeným zpracováním nebo na pauze |
| 4.5c | `asOf` se ukládá na kampaň a předává do každé dávky materializace beze změny | jinak se publikum mění pod rukama, viz 4.11.3 |
| 4.5d | Filtr publika používá `contacts.status = 'active'`, nikoliv `'subscribed'`. Hodnota `subscribed` v této části neexistuje a dotaz s ní vrátí nula řádků | výčet je ve 4.1.6 |
| 4.5e | Volání `suppressions.add` z 4.10.4 při bounci, stížnosti a `OnAccountSuppressionList`. Přímý `INSERT` do `suppressions` je zakázaný, protože kolem něj visí pět doménových efektů | signatura ve 4.10.4; `metadata` s diagnostikou bouncu |
| 4.6 | Hlavičky `List-Unsubscribe` a `List-Unsubscribe-Post` podle 4.9.1, a **DKIM podpis musí obě hlavičky pokrývat** | bez toho není one-click podle RFC 8058 platný |
| 4.7 | Odhlašovací token se generuje s payloadem z 4.9.3, včetně `l` (list_id) tam, kde kampaň míří na seznam | rozlišení odhlášení ze seznamu a globálního |
| 4.8 | Zápis do suppression listu při tvrdém odrazu a stížnosti podle matice v 4.10.1, včetně `email_hash` | |
| 4.9 | Práh měkkých odrazů vlastní část 4a. Tato část ho **nedefinuje** a jen konzumuje volání `suppressions.add` s `reason = 'soft_bounce_threshold'` | hodnota je na části 4a |
| 4.14 | Placeholder anonymizované adresy je **`erased+{contact_id}@erased.invalid`**, jednotně napříč částmi | část 4a používá jiný tvar, sjednotit na tento |
| 4.10 | Při výmazu podle čl. 17: `messages.contact_id = NULL`, `messages.email` na placeholder, `render_data = '{}'` pro daný kontakt | job `gdpr.sever_links` |
| 4.11 | Index `messages (workspace_id, contact_id)`, aby 4.10 a export dat subjektu neprocházely celou tabulku | |
| 4.12 | Příznak na kampani „použij neutrální oslovení u nejistých". Materializace ho realizuje výrazem `CASE WHEN $neutral AND c.vocative_confidence = 'low' AND c.vocative_locked = false THEN c.greeting_neutral ELSE c.greeting END`. Sloupec `greeting_neutral` dodává tato část, viz 4.4.7 | podmínka musí být `low AND NOT locked`, aby seděla na počet, který dialog uživateli slíbil |
| 4.13 | Odesílání potvrzovacích, uvítacích a reaktivačních e-mailů přes stejnou cestu jako kampaně, ale s vyšší prioritou a **s obcházením zpoždění plánovače** | potvrzovací e-mail, který přijde za hodinu, je k ničemu |

### 11.4 Na část 5 (tracking)

| # | Požadavek | Proč |
|---|---|---|
| 5.1 | Formát podepsaného tokenu, který unese payloady z 4.9.3 (`k`, `w`, `c`, `m`, `ca`, `l`, `exp`) a podporuje `exp = 0` jako „bez expirace" | odhlašovací a preferenční odkazy |
| 5.2 | Ověřovací funkce tokenu použitelná i mimo trackovací endpointy | `/u/`, `/p/`, `/r/`, `/s/c/` |
| 5.3 | **Rollup tabulka `contact_engagement`** | Bez ní jsou engagement podmínky v segmentech a presety čištění nepoužitelné nad 100 miliony událostí |
| 5.4 | Aktualizace `contacts.last_activity_at` při otevření, kliknutí a webovém eventu | presety „neaktivní 90+ dní" |
| 5.5 | Při výmazu podle čl. 17: `web_events.contact_id = NULL`, smazání `identities` a `contact_engagement` pro daný kontakt | |
| 5.6 | Index `web_events (workspace_id, contact_id)` na každé partition | aby 5.5 a export dat subjektu byly proveditelné |
| 5.7 | Data pro `message_events.csv` a `web_events.ndjson` v GDPR exportu | seznam sloupců k dohodě |
| 5.8 | Web SDK **nesmí** startovat bez souhlasu; stav souhlasu čte z `contact_consent_state`, respektive z hodnoty předané v `OpenEngage.consent()` | pravidlo z kapitoly 6.7 hlavní specifikace |

Navrhovaný tvar `contact_engagement` (vlastní část 5, uvedeno jako podklad):

```sql
CREATE TABLE contact_engagement (
  contact_id            uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id          uuid NOT NULL,
  last_sent_at          timestamptz,
  last_delivered_at     timestamptz,
  last_open_at          timestamptz,
  last_click_at         timestamptz,
  last_bounce_at        timestamptz,
  sent_total            int NOT NULL DEFAULT 0,
  opens_total           int NOT NULL DEFAULT 0,
  clicks_total          int NOT NULL DEFAULT 0,
  bounces_total         int NOT NULL DEFAULT 0,
  sent_7d, sent_30d, sent_90d       int NOT NULL DEFAULT 0,
  opens_7d, opens_30d, opens_90d    int NOT NULL DEFAULT 0,
  clicks_7d, clicks_30d, clicks_90d int NOT NULL DEFAULT 0,
  consecutive_no_open   int NOT NULL DEFAULT 0,   -- pro "neotevřel posledních N kampaní"
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_engagement__ws_last_open ON contact_engagement (workspace_id, last_open_at);
CREATE INDEX idx_contact_engagement__ws_no_open  ON contact_engagement (workspace_id, consecutive_no_open);
```

### 11.5 Na část 6 (UI a UX), pokud tuhle roli vlastní

Sekce 6 tohoto dokumentu popisuje obrazovky a texty z pohledu domény. Vizuální provedení, komponenty a design systém vlastní část 6. Konkrétně potřebuji:

- komponentu pro vícekrokového průvodce s možností návratu (import),
- komponentu tabulky s hromadným výběrem, kde je počet vybraných vidět i po přestránkování,
- vizuální query builder s vnořenými skupinami,
- veřejné stránky mimo layout aplikace s minimálním stylem, které fungují bez JavaScriptu.

---

## 12. Rozpory s hlavní specifikací

Hlavní specifikace se neupravuje. Následující body se při rozpisu ukázaly jako nepřesné nebo nedostatečné.

**R1. `suppressions` bez primárního klíče.** Kapitola 5 uvádí `suppressions(workspace_id, email, reason, source, created_at)`. Bez `id` nejde na položku odkazovat z auditu ani ji adresovat v API při odebírání. Návrh: přidat `id uuid PRIMARY KEY`, `email_hash`, `removable`, `removed_at`, `removed_by`, `removal_note`. Dopad: žádný na ostatní části.

**R2. Chybí model odvození `contacts.status` versus `suppressions`.** Kapitola 5 uvádí obojí, ale neříká, co je zdroj pravdy. Dva zdroje pravdy pro „smí se poslat" jsou spolehlivý zdroj chyb. Návrh: **`suppressions` je autoritativní**, `contacts.status` je odvozený údaj pro zobrazení a levné filtrování, udržovaný v téže transakci. Materializace publika (část 4) musí kontrolovat `suppressions`, ne `status`. Dopad: požadavek 4.1 v sekci 11.3.

**R3. `contacts.title` je jedno pole, ale tituly jsou dvě různé věci.** Kapitola 6.3 uvádí `title` jako jeden sloupec. Tituly před jménem (`Ing.`, `MUDr.`) a za jménem (`Ph.D.`, `MBA`) se v oslovení chovají úplně jinak a nejde je uložit do jednoho pole, aniž by se ztratila informace o pozici. Návrh: `title_prefix` a `title_suffix`. Dopad: dva merge tagy místo jednoho, požadavek 3.1.

**R4. Chybí pole pro prostřední jméno.** U vietnamských a arabských jmen je prostřední část běžná a její vložení do `first_name` zkazí vokativ i oslovení. Návrh: `middle_name`. Dopad: minimální, merge tag navíc.

**R5. Rod jako `female | male | unknown` nemá zaznamenaný zdroj.** Bez `gender_source` nejde odlišit hodnotu, kterou uživatel dodal, od hodnoty, kterou uhodla knihovna, a tím pádem ani rozhodnout, jestli ji smí přepsat přepočet. Návrh: `gender_source`. Dopad: žádný.

**R6. `vocative_confidence` jako `high | low` nestačí.** Chybí třetí stav pro „vokativ neexistuje" (cizí písmo, prázdné jméno). Bez něj by kontakt bez jména spadl do fronty ke kontrole, kde s ním nikdo nic neudělá. Návrh: `high | low | none`. Dopad: žádný.

**R7. Chybí `contacts.greeting` jako uložený sloupec.** Kapitola 6.3 popisuje `{{ contact.greeting }}` jako merge tag s fallbackem, ale neříká, kde se počítá. Když se počítá až v šabloně, znamená to logiku v senderu, což celá kapitola 6.3 zakazuje. Návrh: `greeting` je sloupec počítaný při zápisu, stejně jako vokativy. Dopad: `render_data` obsahuje hotový řetězec, sender jen dosadí, což je přesně to, co kapitola 6.3 chce.

**R8. Kapitola 6.2 uvádí operátor „za posledních N dní" bez definice chování u prázdné hodnoty.** Tříhodnotová logika v SQL je nejčastější zdroj nepochopení segmentů. Návrh: každý listový predikát obalený `coalesce(..., false)` plus samostatný operátor `is_empty` a nápověda v UI, viz 4.11.3.

**R9. Kapitola 5 neuvádí, co se stane s eventy při výmazu podle GDPR.** Je to nejdůležitější otázka celé GDPR části a hlavní specifikace ji nechává otevřenou. Návrh je v 4.14.4: události zůstávají, vazba na osobu se odstřihne, agregované statistiky se nemění. Dopad: požadavky 4.10 a 5.5.

**R10. Kapitola 9 vyžaduje „export dat subjektu a smazání nebo anonymizaci historie", ale nedefinuje lhůtu.** Čl. 12 odst. 3 GDPR stanoví jeden měsíc s možností prodloužení o dva. Bez sledování lhůty je funkce nepoužitelná pro doložení souladu. Návrh: `gdpr_requests.due_at` a `extended_until`, viz 3.11.

**R11. Kapitola 6.3 doporučuje `czech-vocative` bez uvedení, že knihovna nedělá detekci rodu ze slovníku jmen.** Ověřením se ukázalo, že `isWoman()` je čistě příponová heuristika s 720 pravidly a na necheských jménech vrací v podstatě náhodu (`isWoman("Zhang") = true`). Návrh: vlastní slovník křestních jmen jako hlavní zdroj a knihovna až jako poslední záchrana, viz 4.4.4 a 4.4.5.

**R12. Kapitola 6.3 neuvádí riziko poškozeného výstupu při vynuceném rodu.** Měřením se ukázalo, že `vocative("Nováková", false, true)` vrátí `"Novákováe"`. Návrh: nikdy nevolat s vynuceným mužským rodem u nejistého rodu, plus pojistka „výsledek delší o víc než 3 znaky znamená `low`", viz 4.4.6.

**R13. Kapitola 5 uvádí `PostgreSQL 17`, část 1 volí 18.** Přijímám volbu části 1, viz 2.1. Zaznamenáno jen kvůli úplnosti, rozhodnutí je na části 1.

### 12.1 Rozpory s částí 1

Části 1 nic neměním. Následující tři body považuju za místa, kde její konvence nesedí na potřeby kontaktů, a nechávám je na rozhodnutí orchestrátora.

**C1. Rozšíření omezená na `citext`.** Konvence 2.1 části 1 uvádí „Rozšíření: `citext` (jen pro e-maily)". Kontakty potřebují navíc `pg_trgm` a `btree_gin`, jinak není hledání kontaktu podle části jména nebo adresy. Hledání „nov" nad pěti miliony řádků bez trigramového indexu je seq scan v řádu sekund, a hledání kontaktu je nejčastější operace v celém nástroji.

Alternativa bez rozšíření: `email LIKE 'nov%'` nad btree indexem `(workspace_id, email text_pattern_ops)`. Funguje jen na prefix, takže „najdi Nováka" podle příjmení uprostřed adresy přestane fungovat úplně. Považuju to za citelné zhoršení, ale je to schůdné, pokud část 1 chce držet seznam rozšíření co nejkratší kvůli kompatibilitě s externím Postgresem u self-hosterů. **Poznámka k tomu argumentu:** `pg_trgm` i `btree_gin` jsou `contrib` moduly dodávané s oficiální image `postgres:18-alpine` i s většinou spravovaných služeb, takže cena za ně je nižší než u exotických rozšíření.

**C2. Odvození všech klíčů ze `SECRET_KEY` přes HKDF.** Konvence 3.10 části 1 popisuje rotaci `SECRET_KEY` jako běžnou operaci a všechny klíče z něj odvozuje. Pro **otisk vymazané adresy** to nefunguje: otisk musí být porovnatelný roky dopředu, protože je to jediná zábrana proti tomu, aby import vzkřísil člověka, který uplatnil právo na výmaz. Rotace klíče by všechny existující otisky zneplatnila a udělala z nich mrtvá data.

Řešení, které navrhuju, je vyhradit `SUPPRESSION_HASH_KEY` jako samostatnou, výslovně **nerotovatelnou** proměnnou mimo hierarchii HKDF, s otiskem uloženým v `system_settings` a s tvrdým pádem při startu, pokud se změní. Je to výjimka z konvence a patří sem, protože „všechno se odvozuje ze `SECRET_KEY`" je jinak dobré a jednoduché pravidlo.

**C3. `REVOKE UPDATE, DELETE ON consents` bez protistrany pro GDPR.** Konvence 2.1 části 1 správně dělá `consents` append-only tím, že aplikační roli odebere `UPDATE` a `DELETE`. Výmaz podle čl. 17 ale musí souhlasy smazat, jinak po „smazaném" člověku zůstane jeho e-mail v `consents.evidence`. Část 1 tuhle protistranu nedefinuje.

Navrhuju roli `openengage_gdpr` s `DELETE ON consents` a ničím navíc, používanou výhradně jobem `gdpr.erase`, s povinným záznamem v `audit_log`. Alternativa (nechat souhlasy a smazat z nich jen osobní údaje) je horší, protože souhlas bez identifikace subjektu není důkaz o ničem.

---

## 13. Otevřené otázky

| # | Otázka | Kdo rozhoduje | Návrh |
|---|---|---|---|
| O1 | Má se u nejistého rodu použít nejlepší odhad, nebo neutrální oslovení? | produkt | Neutrální při politice `strict`, odhad při `balanced`. Výchozí `balanced`, protože jinak dostane většina kontaktů „Dobrý den" bez jména a funkce ztratí smysl |
| ~~O2~~ | ~~Je 30denní čekání a jedna adresa po druhé u odblokování tvrdých odrazů únosné?~~ | **uzavřeno** | **Návrh potvrzen beze změny.** Tvrdý odraz jde odblokovat nejdřív po 30 dnech a vždy jen po jedné adrese, stížnost nikdy, hromadné odblokování neexistuje. Reálný případ „firma změnila server" se řeší tím, že to nebyl tvrdý odraz, ale měkký. Tahle verze platí i pro část 4a, která svůj protinávrh stáhla |
| O3 | Dvoukrokové potvrzení jako výchozí, nebo jednokrokové? | produkt, ideálně s právníkem | Dvoukrokové. Cena je 5 až 15 procent konverze, přínos je, že potvrzení skutečně udělal člověk |
| O4 | Je uchování HMAC otisku vymazané adresy obhajitelné podle GDPR? | právník | Ano, jako opatření k výkonu práva subjektu. Alternativa (nulová stopa) znamená, že další import člověka vzkřísí, což je horší porušení. K potvrzení |
| O5 | Odkud vzít slovník českých křestních jmen s ověřenou licencí? | vývoj | Kandidáti: otevřená data ČSÚ o četnosti jmen, seznam z Wikidat (CC0), ruční sestavení z 3 000 nejčastějších jmen. Musí se ověřit licence a uvést v `NOTICE`. Modul funguje i bez slovníku |
| O6 | Má formulář ve výchozím stavu nabízet Turnstile? | produkt | Ne. Odporuje slibu o nulové komunikaci s cizím cloudem. Nechat vypnuté a viditelně označené |
| O7 | Je limit 100 vlastních polí a 8 indexovaných dostatečný? | produkt | Ano pro MVP 0. Zvýšení je čistá změna konstanty |
| O8 | Má být `soft_opt_in` v produktu vůbec nabízený? | právník | Ano, ale s výslovným varováním. Je to v ČR běžně používaná výjimka a nabízení jen `consent` by uživatele nutilo lhát ve výběru právního titulu |
| O9 | Kolik dní má trvat reaktivační okno? | produkt | 14 dní výchozí, volitelně 7 až 60 |
| O10 | Vietnamské pořadí jména: hádat, nebo se vždy zeptat? | produkt | Hádat s varováním a zařazením do fronty ke kontrole. Vždy se ptát znamená u vietnamského seznamu nepoužitelný import |
| O11 | Má být hledání kontaktů trigramové (drahé, 900 MB indexu), nebo jen prefixové? | produkt a provoz | Trigramové s možností vypnout přepínačem u velkých instalací, viz 8.4 bod 4 |
| O12 | Kdo vlastní texty veřejných stránek z pohledu právního znění (potvrzení, odhlášení, souhlas)? | produkt a právník | Výchozí znění dodá tato část, projekt si je může přepsat. Znění souhlasu se ukládá k záznamu, takže změna neovlivní staré souhlasy |

---

## Příloha A: Mapa 18 kontrolních otázek

| # | Otázka ze zadání | Kde je zodpovězená |
|---|---|---|
| 1 | Úplné DDL kontaktů včetně indexů, které dotazy musí zůstat rychlé při 5 M kontaktů | 3.1 (DDL, indexy s odůvodněním, odhad velikosti), 8.2 (tabulka dotazů a cílů) |
| 2 | Vlastní pole: typy, validace, `jsonb` nebo sloupce, indexace pro segmentaci | 4.2.1 (proč `jsonb`), 4.2.2 (typy a `options`), 4.2.3 (koerce s testovacími vektory), 4.2.4 (dvojí indexace) |
| 3 | Upsert politika přes API, import a formulář | 4.1.2 (matice kanálů a režimů, šest pravidel bez výjimky), 4.1.3 (tvar dotazu) |
| 4 | Import: kódování, oddělovač, limity, chunking, částečné selhání, report chyb, idempotence | 4.6 celá, zejména 4.6.1 (limity), 4.6.2 (ověřená detekce kódování), 4.6.3 (oddělovač), 4.6.8 (checkpoint a obnova), 4.6.9 (idempotence), 4.6.11 (katalog chyb) |
| 5 | Rozdělení jména: tituly, pořadí, dvojitá příjmení, předložková, apostrofy, jednoslovné hodnoty | 4.4.2 (tituly), 4.4.3 (tabulka pravidel včetně `n = 1`, částic, vietnamského pořadí, nedělitelných celků) |
| 6 | Vokativ: API knihovny, určení rodu, co je „low confidence", fallbacky, necheská jména | 4.4.4 (priorita určení rodu), 4.4.5 (ověřené API a chování knihovny včetně měření), 4.4.6 (výpočet a pravidla snížení jistoty), 4.4.7 (oslovení a fallbacky) |
| 7 | Fronta ke kontrole: hromadné potvrzení, ruční oprava, zamknutí, přepočet po změně jména | 4.5 celá, zejména 4.5.2 (seskupení), 4.5.3 (operace), 4.4.8 (chování zámku při změně jména) |
| 8 | Úplné JSON schéma segmentového AST, operátory, typová kompatibilita | 4.11.1 (schéma a TypeScript typy), 4.11.2 (operátory a typová kompatibilita) |
| 9 | Kompilace AST do SQL bez injection, limit složitosti | 4.11.3 (tři vrstvy ochrany, konstantní mapa sloupců, klíč jako parametr, kontrola příslušnosti k projektu), 4.11.4 (limity) |
| 10 | Náhled počtu: aby nezablokoval databázi, co při dlouhém běhu | 4.11.5 (read-only pool, `statement_timeout`, fallback na odhad z `EXPLAIN`) |
| 11 | Přepočet segmentů: kdy, jak často, na základě čeho, při 5 M kontaktů | 4.11.6 (spouštěče, souběžnost, časy měřené na 5 M) |
| 12 | Double opt-in: úplný stavový diagram, platnost tokenu, opakované přihlášení, odhlášený, suppression | 4.8.1 (diagram a úplná tabulka přechodů včetně zakázaných), 4.8.2 (token), 4.8.3 (jedno- versus dvoukrokové), 4.8.4 (chování stránek) |
| 13 | Odhlášení: RFC 8058, preference, per seznam versus globální, běžící kampaň | 4.9.1 (ověřené požadavky RFC 8058), 4.9.2 (rozsah), 4.9.3 (payload tokenu), 4.9.4 (dopad na běžící kampaň včetně přiznaného okna), 4.9.5 (stránka preferencí) |
| 14 | Suppression: co ho plní, kdo smí odebrat, import adresy na listu | 4.10.1 (plnění), 4.10.2 (matice odebrání), 4.10.3 (kontrola), 4.10.4 (import) |
| 15 | Souhlasy: model, zdroj a čas, export dat subjektu, výmaz, co s eventy a statistikami | 3.4 (DDL), 4.14.1 (model), 4.14.2 (přístup a přenositelnost), 4.14.4 (výmaz, co se stane s eventy a statistikami), 4.14.6 (ověření žadatele) |
| 16 | Retence: co se maže, konfigurace, spouštění, logování | 3.11 (DDL), 4.15 (cíle, výchozí hodnoty, mechanismus, pojistky) |
| 17 | Formuláře: embed, antispam, CSRF, stylování, bez JavaScriptu, kam se ukládají odeslání | 4.13.1 (tři varianty vložení), 4.13.2 (bez JavaScriptu), 4.13.3 (pět vrstev ochrany a proč ne CSRF token), 4.13.4 (double opt-in), 4.13.6 (co se stane po odeslání) |
| 18 | Příchozí webhooky: mapování bez kódu, ověření podpisu, neznámý tvar | 4.16.1 (režimy ověření), 4.16.2 (deklarativní mapování a jeho gramatika), 4.16.3 (průvodce pro neznámý tvar), 4.16.4 (odpovědi a idempotence) |

Všech 18 otázek je zodpovězeno.

