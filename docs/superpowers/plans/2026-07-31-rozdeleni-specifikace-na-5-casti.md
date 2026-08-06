# Rozdělení specifikace na 5 částí

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Zápis z 31. 7. 2026 o tom, jak se hlavní specifikace
> rozdělila na části a co měl kdo napsat. **Práce, kterou zadává, je dávno hotová:** sedm částí
> leží v `docs/superpowers/specs/parts/` a jsou to platné dokumenty. Tenhle soubor je jen zadání k jejich sepsání.
> Větve `spec/*` z tabulky níž už neexistují, pracuje se na `main`.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Datum: 2026-07-31
Vstup: `docs/superpowers/specs/2026-07-31-mailing-tool-spec.md` (dále "hlavní specifikace")
Výstup: pět detailních dokumentů v `docs/superpowers/specs/parts/`
Cíl: z každé části musí jít vygenerovat implementační plán, který se dá rovnou stavět, ne dál dohadovat

---

## 1. Jak to funguje

Hlavní specifikace je rozhodnutá, ale je to rozhodovací dokument, ne stavební. Odpovídá na "co a proč", ne na "jak přesně". Těchto pět částí ji dopisuje do stavu, kdy je **rozhodnutě úplná**: nezbývá nic, co by musel dohadovat implementátor.

Každou část vlastní jeden člověk. Píše ji do vlastního souboru na vlastní větvi, takže se nikdo s nikým nemerguje.

| # | Část | Soubor | Větev |
|---|---|---|---|
| 1 | Platforma, identita a provoz | `parts/01-platforma.md` | `spec/01-platforma` |
| 2 | Kontakty, segmenty a souhlasy | `parts/02-kontakty.md` | `spec/02-kontakty` |
| 3 | Obsah: šablony, editor a AI | `parts/03-obsah.md` | `spec/03-obsah` |
| 4 | Odesílání: kampaně, sender, doručitelnost | `parts/04-odesilani.md` | `spec/04-odesilani` |
| 5 | Tracking, timeline a reporty | `parts/05-tracking.md` | `spec/05-tracking` |

**Hlavní specifikace se nemění.** Když z detailního rozpisu vyplyne, že je někde špatně, napíše se to do sekce "Rozpory s hlavní specifikací" ve vlastní části a řeší se na společné synchronizaci. Nikdo needituje hlavní specifikaci sám, protože ji čtou všichni ostatní jako pevný bod.

---

## 2. Úroveň detailu

Tohle je nejdůležitější kapitola celého dokumentu. Přečíst dvakrát.

### Kritérium

> Specifikace je hotová, když ji dva různí implementátoři přečtou nezávisle na sobě a postaví z ní **stejnou** věc.

Když si musí cokoliv domyslet, není hotová. "Domyslí si to Claude Code" je nejrychlejší cesta k pěti nekompatibilním komponentám.

### Konkrétně to znamená

Pro každou funkci v části musí být zodpovězeno:

1. **Datový model.** Skutečné DDL včetně typů, `NOT NULL`, výchozích hodnot, cizích klíčů, indexů a důvodu, proč ten index existuje.
2. **Rozhraní.** Přesné signatury: cesta, metoda, request, response, chybové stavy. U TypeScriptu rovnou typy.
3. **Stavy a přechody.** Kdykoliv něco má stav, patří tam diagram nebo tabulka přechodů včetně toho, co je zakázáno.
4. **Chybové cesty.** Co se stane, když to selže. Ne "ošetřit chyby", ale konkrétně které, s jakým kódem, co uvidí uživatel a jestli se to opakuje.
5. **Hranice a limity.** Maximální velikosti, počty, timeouty, co se stane při překročení.
6. **Souběh a idempotence.** Co když to poběží dvakrát. Co když se to restartuje uprostřed.
7. **Akceptační kritéria.** Testovatelné věty, ze kterých jde napsat test, aniž se člověk ptá.

### Příklad, jak to nemá vypadat

> Import podporuje CSV s mapováním sloupců a náhledem před potvrzením. Chyby se uživateli zobrazí.

Tohle nedá implementátorovi nic. Kódování? Oddělovač? Limit velikosti? Co s chybným řádkem 4312? Co když nahraje stejný soubor dvakrát?

### Příklad, jak to vypadat má

> **Import CSV**
>
> Limit 200 MB a 5 000 000 řádků. Soubor jde do úložiště, ne do paměti, zpracovává se po dávkách 1 000 řádků.
>
> **Detekce kódování** proběhne z prvních 64 kB v pořadí: BOM, pak UTF-8 validace, jinak fallback na `windows-1250`. Fallback je pro české prostředí ten důležitý případ, protože Excel s českým locale exportuje CP1250 se středníkem. Detekované kódování i oddělovač se ukážou v náhledu a jdou ručně přepsat.
>
> **Oddělovač** se hádá podle četnosti `;`, `,` a `\t` na prvních 20 řádcích.
>
> **Náhled** ukáže prvních 20 řádků po namapování, včetně odvozeného rodu a vokativu.
>
> **Kolize e-mailu** se řeší podle volby uživatele: `skip`, `update` (jen neprázdná pole ze souboru) nebo `overwrite`. Výchozí je `update`.
>
> **Chybný řádek** import nezastaví. Zapíše se do `import_errors(import_id, row_number, raw_line, error_code)` a pokračuje se. Import skončí jako `completed_with_errors` a nabídne CSV s chybnými řádky ke stažení a opravě.
>
> **Idempotence:** každý import má `idempotency_key` odvozený ze SHA-256 obsahu souboru a ID projektu. Nahrání stejného souboru do 24 hodin vrátí původní import a zeptá se, jestli ho uživatel opravdu chce pustit znovu.
>
> **Stavy:** `pending → validating → previewing → importing → completed | completed_with_errors | failed | cancelled`. Z `importing` jde na `cancelled`, už zpracované řádky zůstávají.
>
> ```sql
> CREATE TABLE imports (
>   id uuid PRIMARY KEY,
>   workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
>   status text NOT NULL,
>   idempotency_key text NOT NULL,
>   total_rows int, processed_rows int DEFAULT 0, error_rows int DEFAULT 0,
>   mapping jsonb NOT NULL, options jsonb NOT NULL,
>   created_at timestamptz NOT NULL DEFAULT now()
> );
> CREATE UNIQUE INDEX ON imports (workspace_id, idempotency_key);
> ```
>
> **Akceptační kritéria**
> - Soubor z Excelu v CP1250 se středníkem a diakritikou se naimportuje bez poškození znaků.
> - Soubor s 10 chybnými řádky z 1 000 skončí jako `completed_with_errors`, naimportuje 990 kontaktů a nabídne 10 řádků ke stažení.
> - Zabití workeru v půlce importu a restart nezpůsobí duplicity ani přeskočené řádky.

Rozdíl je asi desetinásobek textu a nekonečný rozdíl v použitelnosti. **Tohle je požadovaná úroveň.**

### Rozsah

Odhadem 600 až 1 200 řádků na část. Kratší nejspíš znamená, že něco chybí, výrazně delší nejspíš znamená rozvláčnost. Není to kvóta, je to kalibrace.

### Co se do části nepíše

Kód implementace. DDL, typy, schémata a signatury ano, těla funkcí ne. Když si nejste jistí, jestli něco jde, napište do dokumentu ověřovací poznámku, ne prototyp.

---

## 3. Společná pravidla

### Co nikdo nesmí změnit sám

Tohle je rozhodnuté a závisí na tom ostatních pět částí:

- **Rozdělení jazyků.** Aplikace TypeScript, sender kompilovaná binárka.
- **Licence MIT** a zákaz copyleft závislostí. Každá nová závislost se ověřuje, viz níže.
- **pg-boss pro aplikační joby, outbox se `SKIP LOCKED` pro sender.** Žádný Redis v MVP 0.
- **Čtyři kontrakty TS ↔ Go** z kapitoly 4.5 hlavní specifikace.
- **Vokativ se počítá při zápisu kontaktu**, ne při odesílání.
- **Šablony se ukládají jako JSON**, ne jako HTML.
- **Každá tabulka nese `workspace_id`** a izolace se vynucuje v datové vrstvě.
- **Sender nečte tabulku kontaktů.**

Chcete něco z toho změnit? Do sekce "Rozpory" a na synchronizaci. Ne potichu.

### Nová závislost

Než ji zapíšete do své části, ověřte a do dokumentu uveďte: název, verzi, licenci, datum poslední aktualizace a týdenní stažení. Povolené licence jsou MIT, Apache-2.0, BSD, ISC. LGPL taky ne, v JavaScriptu se knihovna bundluje a argument o dynamickém linkování neobstojí.

```bash
npm view <balíček> license version time.modified
curl -s https://api.npmjs.org/downloads/point/last-week/<balíček>
```

### Jazyk a formát

Text česky, kód a identifikátory anglicky. Bez dlouhých pomlček. Markdown, tabulky na výčty, SQL bloky na DDL, TypeScript bloky na typy.

### Cizí území

Když potřebujete něco, co vlastní jiná část, **nespecifikujte to za ně**. Napište do sekce "Požadavky na ostatní části" konkrétní požadavek: co potřebujete, v jakém tvaru a proč. Autor druhé části to zapracuje. Dvě části popisující totéž jinak jsou horší než mezera.

---

## 4. Pět částí

Každá část má stejnou kostru: co vlastní, co nevlastní, které kapitoly hlavní specifikace rozvíjí, a kontrolní otázky. **Kontrolní otázky nejsou úplný seznam obsahu**, jsou to místa, kde hlavní specifikace mlčí a implementátor by se zasekl. Zodpovězení všech je nutná, ne postačující podmínka.

---

### Část 1: Platforma, identita a provoz

Rozvíjí kapitoly: 3, 4.1, 4.5, 6.1, 9

Tahle část je základ, na kterém stojí ostatní čtyři. Má nejkratší lhůtu, protože její konvence ostatní potřebují hned.

**Vlastní**

- Struktura monorepa, build, sdílené konfigurace, konvence pojmenování
- Schéma databáze jako celek: konvence, migrace, verzování, partitioning
- Autentizace, uživatelé, sessions
- Projekty (workspaces), členství, role a oprávnění
- API klíče, scopes, ověřování
- Model izolace projektů a jeho vynucení
- Framework veřejného API: routing, validace, chyby, verzování, rate limiting, OpenAPI
- Infrastruktura odchozích webhooků (doručování, retry, podpisy, log)
- i18n infrastruktura
- Design systém a layout aplikace
- Docker image, compose, konfigurace, healthchecky, graceful shutdown
- Zálohování, obnova, upgrade
- CI, testovací strategie, licenční brána
- **Čtyři kontrakty TS ↔ Go z kapitoly 4.5**

**Nevlastní**

Doménová data (části 2 až 5), konkrétní endpointy jednotlivých domén (ty si popisuje každá část sama podle konvence z části 1), obsah webhookových událostí (deklaruje je ta část, které patří).

**Kontrolní otázky**

1. Jak přesně se vynucuje izolace projektů? Row-level security v Postgresu, nebo repository vrstva? Jak vypadá test, který se pokusí přečíst cizí projekt a musí selhat?
2. Jaký je přesný formát API klíče, jak se ověřuje (aby porovnání bylo časově konstantní) a jak se vyhodnocují scopes?
3. Kompletní matice rolí a oprávnění: co smí owner, admin, editor a viewer nad každou entitou.
4. Session model: cookie, doba platnosti, obnova, odhlášení ze všech zařízení, co při změně hesla.
5. Formát chybové odpovědi API. Kódy, strojově čitelný typ, i18n hlášek, korelační ID pro dohledání v logu.
6. Rate limiting: kde se aplikuje, jaké limity pro session, API klíč a veřejný klíč, jaký algoritmus, co se vrátí při překročení.
7. Verzování API a co je považováno za breaking change.
8. Kde je zdroj pravdy pro OpenAPI a jak se generuje, aby nemohl zestárnout oproti kódu.
9. **Přesná definice čtyř kontraktů** včetně formátu golden fixtures a toho, jak je pouští CI pro TypeScript i Go.
10. Multi-stage Dockerfile: obsah vrstev, výsledná velikost, uživatel bez rootu, healthcheck, graceful shutdown a jeho timeout.
11. Jak se pouští migrace při startu, když běží víc replik naráz? (Advisory lock je odpověď, popsat mechanismus.)
12. Úplný seznam konfiguračních proměnných: název, typ, povinnost, výchozí hodnota, validace při startu, chování při chybějící hodnotě.
13. Zálohování: co přesně je v záloze, jak se pouští, kam se ukládá, jak se obnovuje a jak se obnova ověřuje.
14. Politika migrací: dopředné a zpětné, co se stane při selhání uprostřed, jak vypadá downgrade.
15. Rotace `SECRET_KEY`: co se stane s existujícími zašifrovanými credentials a s tokeny vydanými starým klíčem.
16. i18n: formát katalogů, klíče, pluralizace, formátování dat a čísel, fallback, jak se překládají e-mailové šablony oproti UI.
17. Doručování odchozích webhooků: retry politika, backoff, kdy se endpoint deaktivuje, formát podpisu, ochrana proti replay.
18. CI: seznam jobů, které jsou blokující, jaký je limit doby běhu, jak se pouští testy senderu vedle testů aplikace.

**Povinné artefakty**

DDL identity tabulek, matice oprávnění, tabulka konfiguračních proměnných, Dockerfile v komentované podobě, `docker-compose.yml`, definice čtyř kontraktů, katalog chybových kódů.

---

### Část 2: Kontakty, segmenty a souhlasy

Rozvíjí kapitoly: 5, 6.2, 6.3, 9 (GDPR)

**Vlastní**

- Kontakty, vlastní pole, štítky
- Jména, rod, vokativ včetně fronty ke kontrole
- Seznamy, přihlášení, double opt-in
- Odhlášení a stránka s preferencemi
- Suppression list
- CSV import a export
- Segmentační engine
- Presety čištění databáze
- Embedovatelné formuláře
- Souhlasy, GDPR operace, retence
- Příchozí webhooky pro zakládání kontaktů

**Nevlastní**

Vzhled e-mailů a merge tagy v šablonách (část 3), výběr publika kampaně (část 4, používá segmenty jako vstup), web eventy a identity resolution (část 5, ale zapisuje do kontaktů, proto viz otázka 15).

**Kontrolní otázky**

1. Úplné DDL kontaktů včetně indexů. Které dotazy musí zůstat rychlé při 5 milionech kontaktů v jednom projektu a čím jsou pokryté?
2. Vlastní pole: jaké typy, jak se validují, jsou v `jsonb` nebo ve vlastních sloupcích, a jak se indexují pro segmentaci?
3. Upsert politika. Přijde kontakt se stejným e-mailem, ale jinými daty, přes API, import a formulář. Co se stane v každém z těch tří případů?
4. Import: kódování, oddělovač, limity, chunking, částečné selhání, report chyb, idempotence. Vzor odpovědi je v kapitole 2 tohoto dokumentu.
5. Rozdělení jména z jednoho sloupce: tituly před jménem i za ním, pořadí jméno a příjmení versus opačně, dvojitá příjmení, předložková příjmení, apostrofy, jednoslovné hodnoty.
6. Vokativ: jaké přesně je API použité knihovny, jak se určuje rod, co je "low confidence", jaká jsou fallback pravidla a co se stane, když jméno není české.
7. Jak vypadá fronta ke kontrole vokativu: hromadné potvrzení, ruční oprava, zamknutí, přepočet po změně jména u zamknutého záznamu.
8. Úplné JSON schéma segmentového AST, seznam operátorů, pravidla typové kompatibility.
9. Jak se AST kompiluje do SQL, aby nešlo podstrčit injection, a jaký je limit složitosti výrazu?
10. Náhled počtu: jak se spočítá, aby nezablokoval databázi, a co se zobrazí, když trvá dlouho?
11. Přepočet segmentů: kdy, jak často, na základě čeho, a co se stane při 5 milionech kontaktů?
12. Double opt-in: úplný stavový diagram. Platnost potvrzovacího tokenu, opakované přihlášení, přihlášení dříve odhlášeného, přihlášení adresy na suppression listu.
13. Odhlášení: one-click podle RFC 8058, stránka s preferencemi, per seznam versus globální, co se stane s běžící kampaní.
14. Suppression: co ho plní, může uživatel položku odebrat a za jakých podmínek, co se stane při importu adresy, která na něm je.
15. Souhlasy: přesný datový model, zaznamenání zdroje a času, jak vypadá export dat subjektu a jak výmaz. Maže se, nebo anonymizuje? Co se stane s eventy a se statistikami kampaní?
16. Retence: co se maže, jak se konfiguruje, jak se to pouští, jak se to loguje.
17. Formuláře: embed kód, ochrana proti spamu, CSRF, stylování, chování bez JavaScriptu, kam se ukládají odeslání.
18. Příchozí webhooky: jak se mapuje cizí payload bez psaní kódu, jak se ověřuje podpis, co při neznámém tvaru.

**Povinné artefakty**

DDL všech tabulek části, JSON schéma segmentového AST s příklady, stavový diagram double opt-in, tabulka pravidel rozdělení jména a určení rodu, katalog chyb importu, seznam presetů čištění.

---

### Část 3: Obsah: šablony, editor a AI

Rozvíjí kapitoly: 6.4, 6.5

**Vlastní**

- Blokový JSON model a jeho verzování
- Editor a jeho integrace
- Univerzální základní šablona
- Renderer fáze 1: JSON na HTML a plain text
- Liquid subset, validátor, katalog merge tagů
- Náhledy a testovací odeslání z pohledu obsahu
- AI asistent, BYOK, nástroje asistenta
- Extrakce značky z webu
- Správa obrázků a assetů

**Nevlastní**

Interpolace při odeslání (část 4, sender), skutečné odeslání testu (část 4), obsah kontaktních polí (část 2, ale merge tagy na ně odkazují, viz otázka 8).

**Kontrolní otázky**

1. Úplné JSON schéma blokového modelu. Jak je verzované a co se stane se šablonou uloženou ve starší verzi schématu?
2. Seznam bloků a u každého úplný výčet vlastností s typy, výchozími hodnotami a mezemi.
3. Renderer: jaká je strategie pro Outlook, jak se řeší dark mode, responzivita a inlining CSS?
4. Kterou matici poštovních klientů garantujeme a jak se testuje? Litmus a Email on Acid jsou placené, takže co použijeme místo nich a co tím ztrácíme?
5. Generování plain textu: přesná pravidla pro nadpisy, odkazy, tlačítka, obrázky a odstavce.
6. Přesná gramatika povoleného Liquid subsetu, chování validátoru a text chybových hlášek.
7. Co se stane, když šablona projde validací, ale za běhu narazí na chybu? Odeslat s prázdnou hodnotou, přeskočit příjemce, nebo zastavit kampaň?
8. Extrakce merge tagů z kompilované šablony: jak se parsují a co se stane, když šablona odkazuje na pole, které v projektu neexistuje nebo bylo smazáno?
9. Co přesně obsahuje univerzální základní šablona a jak se parametrizuje?
10. AI: schémata nástrojů, schéma strukturovaného výstupu, jak se validuje odpověď modelu a co se stane, když neodpovídá schématu?
11. Jak se ukládá historie konverzace s asistentem a je součástí zálohy?
12. Jak se řeší rate limity a chyby jednotlivých providerů a co uvidí uživatel, když mu dojde kredit?
13. **Extrakce značky z webu je server-side fetch na URL zadanou uživatelem, tedy klasický SSRF.** Jak se brání přístupu na privátní rozsahy, localhost a metadata endpointy cloudu? Jaké jsou timeouty, limit velikosti a limit přesměrování? Respektuje se robots.txt?
14. Jak se z webu odvodí paleta barev a logo, a co se stane, když se to nepovede?
15. Obrázky: kam se ukládají, jaké formáty a velikosti, mění se rozměr, jak se odkazují v odeslaném mailu, řeší se hotlinking a jak se to chová v self-hosted nasazení bez S3?
16. Náhled: jak se generuje desktop a mobilní varianta a jak se testuje, že odpovídá skutečnému odeslání?
17. Verzování šablon: je historie, jde se vrátit, co se stane s kampaní, která šablonu používá, když se šablona změní?

**Povinné artefakty**

JSON schéma blokového modelu, katalog bloků, gramatika Liquid subsetu, katalog merge tagů, schémata AI nástrojů, matice podporovaných poštovních klientů, sada golden fixtures pro renderer.

---

### Část 4: Odesílání: kampaně, sender, doručitelnost

Rozvíjí kapitoly: 4.2, 6.6

Největší a nejrizikovější část. Jako jediná zasahuje do obou jazyků.

**Vlastní**

- Kampaně, jejich životní cyklus a plánování
- Sestavení a materializace publika do outboxu
- Sender: claim, interpolace, MIME, dispatch, throttling, retry
- Providery SES a SMTP, jejich konfigurace a ověření
- Příjem a normalizace událostí od providera
- Klasifikace bounců a stížností
- Doručitelnost: SPF, DKIM, DMARC, kvóty, sandbox
- Hlavičky pro odhlášení

**Nevlastní**

Definice segmentů (část 2, jsou vstupem), kompilace šablony (část 3, je vstupem), reporty a statistiky (část 5, konzumují události).

**Kontrolní otázky**

1. Úplný stavový diagram kampaně včetně pauzy, obnovení, zrušení, selhání a částečného odeslání. Které přechody jsou zakázané?
2. Materializace publika: přesný SQL, deduplikace, vyloučení suppression listu, jak dlouho to trvá při milionu kontaktů a běží to v jedné transakci, nebo po dávkách?
3. Co se stane, když se kontakt během odesílání odhlásí nebo se dostane na suppression list? Kontroluje se to znovu při odeslání?
4. Přesné DDL outboxu, claim dotaz, velikost dávky, timeout na uvolnění zaseknutého záznamu.
5. **Jak se zaručí, že se zpráva neodešle dvakrát**, když sender spadne mezi odesláním do SES a zápisem stavu? Popsat konkrétní mechanismus, ne princip.
6. Architektura senderu: kolik goroutin, jak se konfiguruje souběžnost, jak vypadá graceful shutdown a co se stane s rozpracovanou dávkou?
7. Throttling: jaký algoritmus, odkud se bere aktuální kvóta SES, jak se dělí mezi víc běžících senderů a co se stane při odpovědi 429?
8. Retry: které chyby jsou opakovatelné a které trvalé, jaký backoff, kolik pokusů, kam jde trvalé selhání?
9. Přesná struktura MIME zprávy a úplný seznam hlaviček včetně `List-Unsubscribe`, `List-Unsubscribe-Post` a `Message-ID`.
10. SES: použije se `SendEmail`, nebo `SendRawEmail`? Jak se páruje `provider_message_id` s naší zprávou a k čemu se využijí message tagy?
11. **SNS doručuje události nejméně jednou a mimo pořadí.** Jak se zajistí idempotence příjmu a jak se řeší událost, která dorazí ve špatném pořadí (například delivery po bounce)?
12. Jak se přesně ověřuje podpis SNS zprávy a jak se obslouží `SubscriptionConfirmation`?
13. SMTP: connection pooling, TLS, autentizace, limity. Jak se bez webhooků poznají bounce?
14. Klasifikace bounců: hard, soft a transient. Kolik soft bounců po sobě znamená suppression a v jakém okně?
15. Jak se kontrolují SPF, DKIM a DMARC? Jaké DNS dotazy, jak často, co se cachuje a co přesně uvidí uživatel při každém výsledku?
16. Jak se generují DKIM záznamy přes SES API a jak se pozná, že doména je ověřená?
17. Detekce sandboxu a kvót: jaké API, jak často se volá, co se zobrazí a co se stane, když se uživatel pokusí odeslat víc, než smí?
18. Plánované odesílání: v jaké časové zóně, co se stane při výpadku v okamžiku plánu a jak daleko dopředu jde plánovat?
19. Testovací odeslání: obchází suppression list, počítá se do statistik, kde bere data pro merge tagy?
20. Jak se konfiguruje sender, když má vlastního databázového uživatele s omezenými právy? Kde se ta práva zakládají a jak se to nasazuje?

**Povinné artefakty**

Stavový diagram kampaně, DDL outboxu s claim dotazem, tabulka mapování událostí providera na interní model, tabulka klasifikace bounců, seznam hlaviček MIME, konfigurace senderu, akceptační scénáře pro pád a restart uprostřed rozesílky.

---

### Část 5: Tracking, timeline a reporty

Rozvíjí kapitoly: 4.3, 4.4, 6.7

**Vlastní**

- Otevření a kliknutí, podepsané tokeny, redirect služba
- Web SDK
- Event ingestion API
- Identity resolution
- Customer timeline
- Reporty kampaní, dashboard, agregace
- Realtime aktualizace v UI

**Nevlastní**

Generování tokenů při odesílání (část 4, ale formát vlastní část 5, viz otázka 1), datový model kontaktu (část 2), souhlasy (část 2, ale SDK je konzumuje).

**Kontrolní otázky**

1. Přesná struktura trackovacích tokenů: pole, kódování, délka, verze, jak se odvozuje klíč. Sender je vyrábí, aplikace ověřuje, takže obojí musí sedět bajt na bajt. Jak se to zafixuje testem?
2. Co se stane s tokeny vydanými před rotací `SECRET_KEY`?
3. Open pixel: jaké cache hlavičky, jaký obsah, jak dlouhá musí být odpověď.
4. **Apple Mail Privacy Protection přednačítá obrázky, takže generuje falešná otevření.** Jak se detekují a jak se to podá uživateli, aby nevěřil nesmyslným číslům?
5. Click redirect: jak se ochrání proti open redirectu, co se stane při neplatném nebo prošlém tokenu a jak se řeší cílové odkazy, které samy mají query parametry?
6. Jaká je nejhorší přijatelná latence redirectu a čím je zaručená?
7. Web SDK: velikost v kB, veřejné API, způsob načtení, chování při odepřeném souhlasu, definice session, dávkování událostí, chování při zavření karty (`sendBeacon`), retry.
8. Ingestion API: přesný payload, validace, CORS, limity velikosti, rate limiting per veřejný klíč.
9. Bot detekce: konkrétně jak. Podle user agenta, podle chování, podle seznamu?
10. Identity resolution: přesný algoritmus. Co se stane, když jeden `anonymous_id` postupně odpovídá dvěma různým kontaktům? Co při odhlášení uživatele? Slučuje se historie a dá se to vrátit?
11. Předání identity z kliku v mailu: přesná sekvence včetně platnosti tokenu, jednorázovosti a chování při vypršení.
12. Eventy: strategie partitioningu, jak se zakládají nové partition, retence, jak se mažou staré.
13. Jak se dotáhne timeline jednoho kontaktu rychle, když má projekt sto milionů událostí? Jaké indexy, jaké stránkování?
14. Reporty: přesná definice každé metriky. Co je unikátní otevření oproti celkovému, jak se počítá míra prokliku, z jakého jmenovatele?
15. Jak se agregují statistiky, aby report kampaně s milionem zpráv otevřel rychle? Předpočítané tabulky, nebo dotaz na živo?
16. Dashboard: jaké dlaždice, jaká období, jak se cachuje a jak se pozná zastaralá hodnota?
17. Realtime: SSE, nebo polling? Jak často, jak se to chová při stovce souběžných uživatelů a co při odpojení?
18. Jak se to celé chová, když je tracking v kampani vypnutý?

**Povinné artefakty**

Specifikace formátu tokenů s testovacími vektory, veřejné API web SDK, schéma ingestion payloadu, algoritmus identity resolution včetně hraničních případů, katalog metrik s definicemi výpočtu, strategie partitioningu a retence.

---

## 5. Harmonogram

| Kdy | Co |
|---|---|
| Den 0, ráno | Část 1 sepíše konvence: DB, API, chyby, konfigurace, čtyři kontrakty. Publikuje jako koncept. |
| Den 0, odpoledne | Části 2 až 5 začínají psát proti těm konvencím. Část 1 pokračuje na zbytku. |
| Den 1 | Všichni píší. Denní patnáctiminutová synchronizace na rozpory a požadavky napříč částmi. |
| Den 2, ráno | Odevzdání konceptů. |
| Den 2, odpoledne | Křížová revize. |
| Den 3 | Zapracování revizí, řešení rozporů, konsolidace. |

Část 1 má náskok schválně. Bez jejích konvencí by ostatní psali každý svým stylem a slévalo by se to potom.

---

## 6. Křížová revize

Každý píše jednu část a recenzuje dvě. Dvojice jsou vybrané podle toho, kde jsou rozhraní.

| Část | Recenzenti | Na co se recenzent soustředí |
|---|---|---|
| 1 | 4, 5 | Drží kontrakty a bezpečnostní model při reálném použití? |
| 2 | 3, 4 | Sedí data kontaktů na merge tagy a na sestavení publika? |
| 3 | 4, 1 | Je kompilovaná šablona pro sender opravdu dostačující? |
| 4 | 3, 5 | Vzniknou události, ze kterých jde postavit reporty? |
| 5 | 2, 1 | Sedí identity resolution na model kontaktů a souhlasů? |

Recenze není korektura. Recenzent hledá tři věci:

1. **Mezeru:** něco, co nevlastní ani jedna část.
2. **Překryv:** dvě části popisují totéž jinak.
3. **Nesplnitelný předpoklad:** část A počítá s něčím, co část B nedodává v tom tvaru.

Výstupem revize je seznam konkrétních nálezů, ne "vypadá to dobře".

---

## 7. Šablona dokumentu části

```markdown
# Část N: Název

Vlastník:
Datum:
Rozvíjí kapitoly hlavní specifikace:
Stav: koncept | po revizi | finální

## 1. Rozsah
Co tato část vlastní a co vědomě nevlastní.

## 2. Datový model
Úplné DDL včetně indexů a zdůvodnění.

## 3. Doménová logika
Po funkcích. U každé: chování, stavy, hraniční případy, chyby, limity.

## 4. Rozhraní
Endpointy, typy, události, konfigurace.

## 5. UI
Obrazovky, stavy (prázdný, načítání, chyba), texty, cs i en.

## 6. Bezpečnost a soukromí
Co je specifické pro tuto část.

## 7. Výkon
Kritické dotazy, očekávané objemy, kde to praskne dřív.

## 8. Akceptační kritéria
Testovatelné věty. Z každé musí jít napsat test.

## 9. Závislosti
Nové knihovny s verzí, licencí a datem poslední aktualizace.

## 10. Požadavky na ostatní části
Co potřebuji od koho a v jakém tvaru.

## 11. Rozpory s hlavní specifikací
Co se při psaní ukázalo jako špatně rozhodnuté a proč.

## 12. Otevřené otázky
Co jsem nedokázal rozhodnout sám a kdo to má rozhodnout.
```

---

## 8. Kontrolní seznam před odevzdáním

- [ ] Každá tabulka má úplné DDL včetně indexů a u každého indexu je důvod
- [ ] Každý endpoint má cestu, metodu, request, response a chybové stavy
- [ ] Každá entita se stavem má tabulku nebo diagram přechodů
- [ ] Každá operace, která může běžet dvakrát, má popsanou idempotenci
- [ ] Každý limit je číslo, ne "rozumná hodnota"
- [ ] Každá nová závislost má ověřenou licenci a datum poslední aktualizace
- [ ] Akceptační kritéria jsou testovatelné věty
- [ ] UI stavy pokrývají prázdný stav, načítání a chybu
- [ ] Texty existují česky i anglicky
- [ ] Sekce "Požadavky na ostatní části" je vyplněná, nebo je tam výslovně "nic"
- [ ] Sekce "Rozpory" je vyplněná, nebo je tam výslovně "žádné"
- [ ] Nikde není dlouhá pomlčka

Poslední test, než odevzdáte: **dejte svou část člověku, který ji nepsal, a nechte ho popsat, co by postavil.** Když se to liší od toho, co jste měli v hlavě, chybí to v dokumentu, ne v jeho hlavě.
