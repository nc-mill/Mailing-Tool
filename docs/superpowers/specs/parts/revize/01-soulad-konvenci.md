# Revize 1: soulad ostatních částí s konvencemi a kontrakty části 1

Vlastník: subagent part1-platforma
Datum: 2026-07-31
Předmět revize: `02-kontakty.md`, `03-obsah.md`, `04a-kampane.md`, `04b-sender.md`, `05-tracking.md`, `06-ui-ux.md`
Stav: koncept, kategorie B je kompletní, kategorie A se doplňuje

---

## 0. Metoda a co je čím ověřené

Tenhle dokument míchá tři zdroje s různou spolehlivostí. Rozlišuju je schválně, aby orchestrátor věděl, čemu může věřit bez dalšího ověřování.

| Značka | Zdroj | Spolehlivost |
|---|---|---|
| **[SKEN]** | Můj vlastní mechanický `grep` napříč všemi šesti dokumenty | Ověřeno, včetně čísla řádku. Falešné poplachy jsem odfiltroval ručně. |
| **[PŘÍMO]** | Přímá zpráva od autora dané části | Primární zdroj, autor popisuje vlastní dokument. |
| **[AUDIT]** | Report podagenta nad jedním dokumentem | Sekundární. Podle pravidla o nedůvěryhodnosti výstupu podagenta jsem každý blokující nález ověřoval vlastním grepem, než jsem ho sem zapsal. |
| **[ORCH]** | Kandidát předložený orchestrátorem | Vyžaduje moje stanovisko, ne ověření. |

**Stav rozpracovanosti k okamžiku odevzdání:** kategorie B je kompletní a je to část, kterou orchestrátor potřebuje k rozhodnutí. Kategorie A je vyplněná z **[SKEN]** a **[PŘÍMO]**, seznamy po částech se doplní, jakmile dorazí zbývající audity. Nezapisuju sem nic, co bych neověřil, ani abych zaplnil místo.

---

## 1. Shrnutí

**Dobrá zpráva, kterou je potřeba říct první:** licenční brána drží. Napříč všemi šesti dokumenty není jediná propuštěná copyleft závislost. `czech-inflection` (LGPL 2.1), `jschardet` (LGPL 2.1+) i `pa11y` (LGPL 3.0-only) jsou všude správně označené jako zakázané a `axe-core` (MPL-2.0) je správně jen vývojová závislost. Autoři si to ohlídali sami, brána nemusela zasahovat.

Čisté je i pět dalších věcí, u kterých jsem čekal problémy: žádný nativní `CREATE TYPE ... AS ENUM`, žádný Redis ani Valkey v MVP 0, žádné offsetové stránkování, žádný prefix `ML_` u proměnných prostředí a žádná část nedefinuje tabulku, kterou vlastní část 1.

**Špatná zpráva:** kategorie B je větší, než jsem čekal, a **většina nálezů v ní jsou chyby v mé části, ne v cizích.** Dvanáct bodů, z toho pět takových, které bych označil jako díru, ne jako preferenci. Tři z nich našly jiné části, dva orchestrátor, jeden jsem našel sám při ověřování cizího nálezu. Je to očekávaný výsledek toho, že část 1 psala kontrakty jako první a bez zpětné vazby od konzumentů.

**Nejdůležitější zjištění celé revize:** nálezy B1 a B6 se navzájem řeší. Invariant, který požaduje část 4a kvůli deduplikaci publika, dělá z chybějící časové složky tokenu čtyřbajtový problém místo osmibajtového. Detail v B1.

---

## 2. Kategorie B: kontrakt nebo konvence části 1 se musí změnit

Tohle je jádro dokumentu. U každého bodu je moje stanovisko, ne převzatý argument druhé strany. **Nic z toho jsem neprovedl**, kontrakty zůstávají zmrazené.

---

### B1. Trackovací token neumožňuje dohledat zprávu **[ORCH]**, potvrzeno dvakrát nezávisle

**Stanovisko: souhlasím, je to díra, a je moje. Předkládám ke schválení řešení, které nemění délku tokenu.**

**Podstata.** `messages` má `PRIMARY KEY (id, created_at)`, protože partitionovaná tabulka musí mít partition key v klíči. Trackovací token nese jen `message_id`. Dohledání zprávy z otevření nebo kliku tedy nemá druhou složku klíče a skončí prohledáním všech partition. Je to přímý důsledek mého vlastního rozporu R5 a měl jsem ho domyslet, když jsem R5 psal.

**Co nejde použít:** token už nese `issued_at`. Nabízí se ho použít, ale nefunguje to. `issued_at` je čas vydání tokenu, tedy zhruba čas odeslání, zatímco `created_at` je čas materializace publika. Mezi nimi můžou být hodiny i dny, a kampaň materializovaná 31. srpna a odeslaná 1. září by měla obě hodnoty v jiném měsíci, tedy v jiné partition. Použít `issued_at` by chybu neopravilo, jen zamaskovalo.

**Návrh: nahradit `issued_at` polem `message_created_at`, uint32 unixové sekundy, big endian, na stejné pozici.**

| Typ | Payload nově | Bajtů | Znaků tokenu | Změna |
|---|---|---|---|---|
| open `o` | workspace_id(16) message_id(16) **message_created_at(u32)** | 36 | 74 | **žádná** |
| click `c` | workspace_id(16) message_id(16) link_id(16) **message_created_at(u32)** | 52 | 96 | **žádná** |
| unsubscribe `u` | workspace_id(16) message_id(16) contact_id(16) list_id(16) **message_created_at(u32)** | 68 | 117 | **žádná** |
| identity `i` | beze změny, zprávu nedohledává | 60 | 106 | žádná |

**Proč nahradit a ne přidat.** `issued_at` jsem zavedl s odůvodněním „aby šlo poznat prastarý klik". To odůvodnění neobstojí: jakmile zprávu dohledám, mám na řádku `sent_at`, což je pro stáří kliku lepší zdroj. `issued_at` je tedy redundantní a jeho nahrazením se nic neztrácí. Token nezmění délku ani o znak.

**Proč to vychází přesně, a tady je ta souvislost s B6.** `created_at` je `timestamptz` s mikrosekundovou přesností, uint32 sekundy by ho useknuly a klíč `(id, created_at)` by nesedl na přesnou shodu. Invariant z B6 to řeší: všechny zprávy jedné kampaně mají **identickou** hodnotu `created_at`, převzatou z `campaigns.audience_built_at`. Stačí tedy do B6 doplnit, že se `audience_built_at` ukládá zaokrouhlené na celé sekundy (`date_trunc('second', now())`), a uint32 je přesná hodnota, ne aproximace. Dohledání je pak `WHERE id = $1 AND created_at = to_timestamp($2)`, tedy přímý zásah do PK indexu jedné partition.

Bez B6 by bylo nutné nést 8 bajtů mikrosekund a tokeny by narostly. Doporučuju proto schválit B1 a B6 **společně, nebo ani jedno**.

**Bezpečnost: nezhoršuje se a nic neprozrazuje.** `message_created_at` je čas materializace publika, tedy jedna hodnota společná všem příjemcům kampaně. Neříká nic o konkrétním příjemci. Kdo token drží, stejně drží i e-mail, jehož hlavička `Date` prozradí totéž s lepší přesností. Pole je uvnitř MAC vstupu, takže ho nejde změnit. Token stále neobsahuje e-mail ani nic čitelného.

**Cena:** přepočítat testovací vektory pro tři typy tokenů. To je pro mě práce na pár minut a je deterministická.

---

### B2. Je stav `sent` koncový **[ORCH]**

**Stanovisko: souhlasím s návrhem orchestrátora bez výhrad. Považuju to za nejdůležitější rozhodnutí celé revize a chci k němu přidat jeden doplněk, bez kterého to nebude fungovat.**

Návrh zní: `messages.status` popisuje **náš výsledek odeslání**, tedy jestli jsme zprávu předali provideru. Co se stalo potom, patří do `message_events`. Pozdní tvrdý bounce nechá stav `sent` a report ho pozná z událostí.

**Proč souhlasím, čtyři důvody v pořadí důležitosti:**

1. **Zabraňuje dvěma pisatelům na jednom sloupci.** Dnes je jediným pisatelem `messages.status` sender. Kdyby aplikace směla přepsat `sent` na `failed` po příchodu bounce, měly by ten sloupec dva pisatele s úplně jinými životními cykly, jeden v Go a jeden v TypeScriptu, bez společné transakce. To je přesně ten druh souběhu, který se neladí. Tohle je hlavní důvod, ostatní tři jsou navrch.
2. **Dělá stavový automat uzavřený a monotónní.** Koncové stavy, které nejsou koncové, znamenají, že každý konzument musí umět zpětnou změnu. Report, dashboard, webhooky i statistiky by musely počítat s tím, že jim včerejší číslo změní minulost.
3. **Věcně je to správně.** `failed` pak znamená „pokusili jsme se a nešlo to", `skipped` znamená „vůbec jsme neposílali". Obojí je náš výsledek. Bounce je výsledek protistrany a do našeho výsledku nepatří.
4. **Řeší spor o zrušení kampaně**, jak orchestrátor správně píše, a nezkreslí dashboard doručitelnosti, protože bounce rate se stejně musí počítat z událostí, ne ze stavu outboxu.

**Doplněk, bez kterého to nebude fungovat.** Do kontraktu je nutné doplnit větu, která to udělá vynutitelným, ne jen doporučeným:

> `message_events` je jediný zdroj pravdy o **doručení**. `messages.status` je jediný zdroj pravdy o **předání provideru**. Report nesmí odvozovat míru doručení, bounce rate ani complaint rate ze `messages.status`. Zpráva ve stavu `sent`, ke které existuje událost typu `bounce`, není v reportu doručená.

Bez téhle věty si první implementátor reportu spočítá „doručeno = `COUNT(status='sent')`" a bude to vypadat, že to funguje, dokud nepřijde první bounce.

**Jeden důsledek k pojmenování, na který upozorňuju.** Se stavem `sent` ve významu „předáno provideru" je název mírně zavádějící, přesnější by bylo `dispatched`. Přejmenování ale znamená změnu kontraktní hodnoty ve všech šesti dokumentech a v obou jazycích. **Nedoporučuju.** Cena je vyšší než užitek, stačí to popsat v kontraktu jednou větou.

**Nahlásit části 4a:** podle **[SKEN]** používá přechod `sent → failed`, který kontrakt zakazuje, a nenahlásila to jako rozpor. Je to kategorie A, viz A-4a-1.

---

### B3. Nerotovatelný klíč pro otisky v suppression listu **[ORCH]**

**Stanovisko: problém je reálný a část 2 ho popsala správně. S navrženým řešením ale nesouhlasím a předkládám jiné, které řeší totéž bez zavedení klíče, který nejde nikdy rotovat.**

**Problém, se kterým souhlasím.** Po výmazu podle GDPR smažeme e-mail, ale musíme si udržet informaci „tuhle adresu už nikdy nepřidávej". Ukládáme proto klíčovaný otisk. Kdyby se klíč rotoval a starý zahodil, otisky přestanou odpovídat, suppression se rozpadne a smazaný člověk se vzkřísí prvním dalším importem. To je věcně správná analýza a je to horší než běžná chyba, protože se projeví jako porušení výmazu, o kterém se nikdo nedozví.

**Proč nesouhlasím s řešením.** Klíč, který je z návrhu nerotovatelný, je trvalá zátěž. Rotace `SECRET_KEY` je reakce na podezření na únik. Klíč, který při úniku nejde vyměnit, znamená, že po incidentu zůstane navždy část systému kompromitovaná a nejde s tím nic dělat. Zavádět takovou vlastnost kvůli pohodlí implementace je špatný obchod.

**Návrh: použít mechanismus, který už v kontraktu je, jen ho rozšířit i na suppression.**

Kontrakt už tenhle problém jednou vyřešil, a to u trackovacích tokenů. Sekce 3.10 říká, že staré klíče v `SECRET_KEY_PREVIOUS` se u trackovacích tokenů nesmí odebrat nikdy, protože e-mail leží v cizí schránce roky. Suppression fingerprinty jsou přesně stejný případ, jen s ještě delším horizontem.

Konkrétně:

1. Otisk se ukládá **spolu s `key_id`**, stejně jako token a šifrová obálka: `suppressions.fingerprint bytea` plus `suppressions.fingerprint_key_id smallint`.
2. Nový purpose `mailer/v1/suppression-fingerprint`, odvozený běžně přes HKDF. **Rotovatelný jako všechno ostatní.**
3. Při kontrole, jestli je adresa na suppression listu, se spočítá otisk **pro každé známé pokolení klíče** a hledá se `WHERE fingerprint = ANY($1)`. Pokolení je nejvýš šest (aktuální plus limit pěti v `SECRET_KEY_PREVIOUS`), takže jde o jeden indexovaný dotaz s polem šesti hodnot, ne o šest dotazů.
4. Do `mlain doctor` a do dokumentace k rotaci přibude tvrdé pravidlo: **`SECRET_KEY_PREVIOUS` se nesmí vyprázdnit, dokud existuje jediný suppression záznam nebo dokud nám záleží na trackovacích odkazech ze starých kampaní.** `oe rotate-credentials` proto **nesmí** hlásit „hotovo, staré klíče můžete odebrat", protože credentials jsou jediné, co se dá přešifrovat.

**Cena.** Šest HMAC výpočtů na adresu při importu. Při importu pěti milionů kontaktů je to třicet milionů HMAC, tedy jednotky desítek sekund jednovláknově a v dávkovaném importu se to ztratí v šumu. Proti tomu stojí zachovaná schopnost rotovat klíč po bezpečnostním incidentu. Ten obchod je jednoznačný.

**Co tím neřeším a je poctivé to říct:** e-mailové adresy jsou vyčíslitelná množina. Kdo získá databázi **i** klíč, může otisky prolomit hrubou silou bez ohledu na to, jaké schéma zvolíme. Otisk chrání proti úniku samotné databáze, ne proti úniku obojího. To platí u obou variant stejně a patří to do dokumentace ke GDPR, ne do volby klíče.

---

### B4. Stránkování versus UI **[ORCH]**

**Stanovisko: souhlasím s analýzou i se směrem řešení. Konvence 4.3 zůstává, počty řeším samostatným endpointem. Číslované stránkování odmítám.**

**Číslované stránky odmítám věcně, ne z principu.** Kurzorové stránkování neumí skočit na stránku 47, protože kurzor je pozice v seřazené množině, ne pořadové číslo. Postavit nad ním čísla stránek jde jen tak, že se pod tím schová `OFFSET`, čímž se ztratí všechno, kvůli čemu kurzor je. U tabulky s pěti miliony kontaktů to znamená, že skok na poslední stránku projde a zahodí pět milionů řádků. Orchestrátor má navíc pravdu i v tom chování uživatele: marketér filtruje, neskáče na stránku 47.

**Návrh tvaru.** Seznam zůstává beze změny podle 4.3. Vedle něj samostatný endpoint na každou kolekci, která to potřebuje:

```
GET /api/v1/contacts/count?<stejné filtry jako u seznamu>
```

```json
{
  "count": 48211,
  "precision": "exact",
  "computed_at": "2026-07-31T14:22:03.000Z",
  "stale": false
}
```

| Pole | Význam |
|---|---|
| `count` | číslo |
| `precision` | `exact` nebo `estimated` |
| `computed_at` | kdy hodnota vznikla |
| `stale` | `true`, když je hodnota z cache a starší než TTL kolekce |

**Pravidlo pro `precision`,** aby endpoint nikdy nebyl pomalý:

1. Spustí se `COUNT(*)` se **stejným indexem jako seznam** a s `statement_timeout` **500 ms**.
2. Když doběhne, vrátí se `exact`.
3. Když narazí na timeout, vrátí se `estimated` z odhadu plánovače (`EXPLAIN` nad tímtéž dotazem, případně `reltuples` škálované selektivitou u nefiltrovaného seznamu).

Tím se malé a středně velké projekty, což je drtivá většina, dozví přesné číslo, a jen ty největší dostanou odhad. Nikdo nečeká.

**UI:** `exact` se zobrazí jako `48 211 kontaktů`, `estimated` jako `~48 000 kontaktů` s tooltipem „přibližný počet, přesné číslo by u téhle velikosti trvalo dlouho".

**Proč samostatný endpoint a ne pole v odpovědi seznamu.** Aby seznam nikdy nečekal na počet. UI vykreslí tabulku hned a počet doplní, až dorazí, případně ho zruší, když uživatel mezitím změní filtr. Kdyby byl počet v odpovědi seznamu, platila by se jeho cena při každém listování.

**Nahlásit části 6:** návrh tabulky s čísly stránek je nesplnitelný předpoklad, viz A-6-1.

---

### B5. Claim dotaz nefiltruje měkce smazanou kampaň **[PŘÍMO, část 4a]**

**Stanovisko: souhlasím, je to díra v mém kontraktu. Předkládám ke schválení.**

Claim dotaz filtruje `w.deleted_at IS NULL`, ale ne `c.deleted_at IS NULL`, přestože `campaigns` je v mém vlastním seznamu měkce mazaných tabulek. Měkce smazaná kampaň ve stavu `sending` by rozesílala dál.

Část 4a to dnes blokuje na úrovni API (smazat jde jen kampaň, která neběží), což je správné, ale spoléhá to na jediné místo v aplikaci. Kampaň je v claim dotazu už joinovaná kvůli `c.status = 'sending'`, takže cena je jeden predikát na už načteném řádku.

```sql
    AND c.status = 'sending'
    AND c.deleted_at IS NULL     -- doplnit
    AND w.deleted_at IS NULL
```

---

### B6. Unikátní index na outboxu nedává záruku, kterou slibuje **[PŘÍMO, část 4a]**

**Stanovisko: souhlasím, a je to horší, než jak to popsala část 4a. Předkládám ke schválení včetně dvou doplňků, které z toho plynou.**

`uq_messages__campaign_contact (campaign_id, contact_id, created_at)` musí obsahovat `created_at`, protože unikátní index na partitionované tabulce musí obsahovat partition key. Bez dalšího invariantu tedy zaručuje jen to, že jeden kontakt nedostane kampaň dvakrát **ve stejný okamžik**, což je záruka, kterou nikdo nepotřebuje. Napsal jsem ho tak, že v dokumentu vypadá jako ochrana proti duplicitám v publiku, a přitom sám o sobě žádnou nedává. To je horší než chybějící index, protože vzbuzuje falešnou důvěru.

**Invariant, který navrhuje část 4a a se kterým souhlasím:**

> Materializace publika použije pro **všechny** zprávy jedné kampaně jednu hodnotu `created_at`, převzatou z `campaigns.audience_built_at`. Sender `created_at` nikdy nepřepisuje.

**Doplněk 1, který z toho plyne a je nutné ho napsat:** všechny zprávy jedné kampaně tím spadnou do **jedné partition**, vybrané v okamžiku materializace. To je žádoucí, protože report kampaně pak čte jednu partition. Ale znamená to, že kampaň materializovaná 31. srpna má všechny zprávy v srpnové partition, i když se dorozesílá v září. **Retenční job nesmí odpojit partition, ve které leží kampaň, jejíž stav není koncový.** Bez toho by dlouhá kampaň přišla o vlastní zprávy.

**Doplněk 2, kvůli B1:** `audience_built_at` se ukládá zaokrouhlené na celé sekundy (`date_trunc('second', now())`). Tím se stane přesně reprezentovatelné jako uint32 a token z B1 nemusí nést mikrosekundy. Bez tohohle doplňku B1 nevyjde a tokeny narostou.

---

### B7. Chybí kořen `workspace.sender_address` v Liquid subsetu **[PŘÍMO, část 3]**

**Stanovisko: souhlasím, předkládám ke schválení. Je to aditivní změna, nic existujícího nerozbíjí.**

Blok patičky potřebuje fyzickou adresu odesílatele. U komerčního e-mailu je identifikace odesílatele včetně adresy právní požadavek, ne volitelnost. Seznam kořenů v 4.10.2 ji nemá.

Část 3 to dnes obchází vložením adresy jako konstanty při kompilaci šablony. Ten postup má konkrétní důsledek: po stěhování firmy se adresa nepromítne do už uložených šablon a všechny se musí překompilovat. To je přesně ten typ tiché chyby, kvůli které se pak rozešle sto tisíc e-mailů se starou adresou.

Návrh: doplnit `workspace.sender_address` (text, může být víceřádkový) do seznamu povolených kořenů. Validátor ho začne přijímat, sender ho dostane v `render_data` jako každý jiný kořen.

---

### B8. Chybí purpose `mailer/v1/asset-url` **[PŘÍMO, část 3]**

**Stanovisko: souhlasím, předkládám ke schválení, ale s povinnou poznámkou do dokumentace.**

Část 3 potřebuje podepisovat adresy obrázků při `ASSET_REQUIRE_SIGNED_URL=true`. Seznam purposes je kontrakt, takže si ho nesmí vzít sama, a správně požádala.

Souhlasím i s tím, že podpis **nesmí mít expiraci**. Je to stejná logika jako u open a click tokenů: e-mail leží ve schránce roky a obrázek se musí zobrazit i za tři roky.

**Povinná poznámka, kterou je nutné napsat do UI i do dokumentace:** podepsaná URL assetu je **trvale platný odkaz**. Kdo ho jednou získá, má ho navždy, protože ho nejde zneplatnit jinak než rotací `SECRET_KEY`, což zneplatní všechny naráz. Pro obrázky v newsletteru je to v pořádku. Pro cokoliv, co má být soukromé, ne. Bez téhle věty si někdo přepínač zapne v domnění, že mu chrání data.

---

### B9. Sloupcové granty a stráž v dispatch UPDATE **[SKEN, část 4b]**

**Stanovisko: obojí vypadá jako vylepšení, které chci převzít. Nepředkládám zatím ke schválení, protože čekám na dokončení auditu části 4b, abych ověřil jejich důkaz, a nechci orchestrátorovi předložit něco, co jsem nedočetl.**

Dvě věci, které část 4b zavedla nad rámec kontraktu:

1. **Sloupcové granty:** `GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at, dispatch_started_at, ...) ON messages`. Můj kontrakt dává `GRANT UPDATE` na celou tabulku. Sloupcová varianta je přísnější a znamená, že chyba v senderu nemůže přepsat `render_data` ani `email`. Vypadá to jako čisté vylepšení bezpečnostní hranice.
2. **Stráž v dispatch UPDATE:** doplňují `AND status='claimed' AND claimed_by=$3` k `SET attempts = attempts + 1, dispatch_started_at = now()`. Argumentují, že bez toho může worker odeslat zprávu, kterou mu mezitím sebral reaper, a vznikne duplicita. Argument mi na první pohled dává smysl, protože mezi claimem a dispatchem je časové okno a reaper běží nezávisle.

Obojí doplním do finálního seznamu, jakmile ověřím jejich důkaz v sekci 3.4.3 jejich dokumentu.

---

### B10. Zkrátit click token použitím `campaign_links.position` **[SKEN, část 4b]**

**Stanovisko: nesouhlasím, doporučuju odmítnout.** Uvádím to tady, protože to část 4b navrhla a orchestrátor by o tom měl rozhodnout, ne aby to zapadlo.

Návrh je nahradit v click tokenu `link_id` (UUID, 16 bajtů) hodnotou `campaign_links.position` (smallint, 2 bajty). Token by se zkrátil z 96 na 77 znaků.

**Proti:**

1. **Úspora je bezcenná.** Devatenáct znaků v odkazu, který nikdo neopisuje ručně a který se ztratí vedle názvu domény. Tracking odkazy běžných nástrojů jsou delší.
2. **Position je nestabilní, UUID není.** Position je pořadí v rámci kampaně. Jakákoliv operace, která překompiluje šablonu a přečísluje odkazy, zneplatní všechny už odeslané tokeny, aniž by to bylo poznat. UUID je stabilní z definice.
3. **Vyžaduje dvojitý lookup.** Position není globálně unikátní, takže rozklíčování vyžaduje nejdřív dohledat zprávu, z ní kampaň a teprve pak odkaz. Token by tak byl závislý na tom, že se úspěšně dohledá zpráva, což je věc, kterou právě opravujeme v B1.

Kdyby byla délka odkazu skutečný problém, správná páka je kratší trackovací doména, ne slabší identifikátor uvnitř tokenu.

---

### B11. Dva různé blocklisty IP rozsahů proti téže hrozbě **[ORCH]**

**Stanovisko: sjednotit seznam rozsahů, ponechat oddělené politiky. Dva seznamy proti stejné hrozbě jsou způsob, jak jeden z nich zastará.**

Rozlišme dvě věci, které se dnes míchají:

| Věc | Má být |
|---|---|
| **Seznam privátních a nesměrovatelných rozsahů** (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` včetně metadat cloudu, `::1`, `fc00::/7`, `fe80::/10`, `0.0.0.0/8`) | **Jeden sdílený.** Je to fakt o IP adresách, ne rozhodnutí produktu. |
| **Politika, jak se seznam použije** | **Oddělená per volající.** Jsou to legitimně různá rozhodnutí. |

Návrh: jedna utilita `packages/core/net/ssrf.ts` s jedním seznamem rozsahů a s politikou předávanou volajícím:

```ts
type SsrfPolicy = {
  allowPrivateNetworks: boolean;   // webhooky false, brand fetch podle konfigurace
  allowHttp: boolean;              // webhooky false, brand fetch true
  extraBlockedHosts: string[];     // brand fetch přidává metadata.google.internal a spol.
  allowedHosts: string[];          // prázdné = bez allowlistu
  resolveAndPin: true;             // vždy, kvůli DNS rebindingu
};
```

Pravidlo `resolveAndPin` je nepodmíněné schválně: kontrola při každém spojení a připojení na ověřenou IP je jediná obrana proti DNS rebindingu a nesmí být volitelná ani pro jednoho volajícího.

Politiky pak zůstanou různé a je to v pořádku, jen to musí být v obou dokumentech napsané nahlas:
- odchozí webhooky: `https` povinné, privátní rozsahy zakázané, protože jde o přenos podepsaného tajemství,
- stahování značky z webu: `http` povolené, protože jde o čtení veřejné stránky, žádné tajemství se nepřenáší a weby zákazníků na `http` reálně existují.

Vlastníkem utility navrhuju část 1, protože blocklist je infrastruktura, ne doména. Části 3 tím nic neubírám, politika a všechny `BRAND_FETCH_*` proměnné zůstávají její.

---

### B12. Partitioning `message_events` podle času události **[SKEN, část 4a]**

**Stanovisko: tady moje konvence měla pravdu a odchylka části 4a je chyba, ne preference. Uvádím to v kategorii B, protože je nutné doplnit zdůvodnění do konvence, aby se to neopakovalo.**

Část 4a partitionuje `message_events` podle `ts`, tedy podle času události **u providera**, s odůvodněním, že je to čas události, ne čas příjmu.

**Proč to nefunguje.** Kontrakt zakazuje výchozí (`DEFAULT`) partition a partition se zakládají tři měsíce **dopředu**, nikdy dozadu. Čas události u providera je hodnota, kterou nám posílá cizí systém, a nemáme nad ní kontrolu. Událost s časem mimo existující rozsah, ať už kvůli špatně nastaveným hodinám na straně provideru, kvůli přehrané staré zprávě, nebo kvůli chybě v datech, **selže při vložení**. Ztratíme událost o doručení a nedozvíme se proč.

Partitioning key musí být hodnota, kterou generujeme my a která je monotónní. Tou je `received_at`.

Návrh: partitionovat podle `received_at`, `ts` ponechat jako běžný indexovaný sloupec a řadit timeline podle něj. Do konvence v 2.1 doplnit větu, která vysvětlí proč, protože samotné pravidlo „partitionuj podle `created_at`" bez odůvodnění vypadá jako formalita a druhý autor ho poruší se stejně dobrým úmyslem.

Totéž se týká `sns_events`, kde část 4a **už** používá `received_at` a je to správně.

---

## 3. Kategorie A: opravit musí ostatní části

### 3.0 Důležité upozornění: dokumenty se mění pod rukama

Mezi mým prvním skenem a dokončením téhle revize autoři dokumenty výrazně přepsali:

| Soubor | Při skenu | Nyní | Nárůst |
|---|---|---|---|
| `02-kontakty.md` | 3380 | 3576 | +196 |
| `03-obsah.md` | 3349 | 3455 | +106 |
| `04a-kampane.md` | 2693 | 2821 | +128 |
| `04b-sender.md` | 1847 | **2516** | +669 |
| `05-tracking.md` | 1628 | **2696** | +1068 |
| `06-ui-ux.md` | 3436 | **4150** | +714 |

**Většinu mých původních nálezů si autoři mezitím opravili sami**, poté co dostali odkaz na část 1. Původní seznam bych je poslal opravovat věci, které už neexistují, což by je zdrželo a podkopalo důvěru v revizi. **Každý nález níž jsem proto před odevzdáním ověřil znovu proti aktuálnímu stavu souboru.** Nálezy, které se mezitím vyřešily, jsem nevyhodil, ale přesunul do 3.7, protože orchestrátor by se jinak divil, kam zmizely.

Číslo řádku je platné k času odevzdání a může se zase posunout. Uvádím proto vždy i citaci, podle které se místo najde.

### 3.1 Část 2 (kontakty)

| ID | Místo | Co je špatně | Jak má být | Závažnost |
|---|---|---|---|---|
| A-2-1 **[SKEN, ověřeno]** | ř. 696, `import_errors` | `id bigserial PRIMARY KEY` | Konvence 2.1 vyžaduje `uuid DEFAULT uuidv7()`. **Moje stanovisko: výjimku uznat, neopravovat.** `import_errors` je interní tabulka bez odkazů zvenčí, ID neopouští systém a při milionech chybných řádků je `bigserial` levnější. Doplním do 2.1 vyjmenovanou výjimku „interní tabulky bez odkazů zvenčí" | DROBNÉ |

Zbytek se doplní z auditu.

### 3.2 Část 3 (obsah)

Podle **[PŘÍMO]** má část 3 konvence zapracované včetně RFC 9457, `<doména>_<problém>`, pojmenování indexů, `deleted_at` u `templates`, `snake_case` v JSON a `@hono/zod-openapi`. Dodává `usedPaths` i `renderSchema` podle požadavku P3-2. Vlastní nálezy části 3 vůči části 1 jsou v kategoriích B7, B8, C1, C2 a C3.

Zbytek se doplní z auditu.

### 3.3 Část 4a (kampaně)

| ID | Místo | Co je špatně | Jak má být | Závažnost |
|---|---|---|---|---|
| A-4a-1 **[SKEN, ověřeno]** | stavový diagram | Používá přechod `sent → failed` při pozdním bounce, který kontrakt 4.10.1 zakazuje, a **nenahlásila to jako rozpor** | Po rozhodnutí o B2: stav zůstane `sent`, bounce jde do `message_events`. Kdyby B2 neprošlo, musí se to nahlásit jako rozpor, ne provést potichu | BLOKUJÍCÍ |
| A-4a-2 **[SKEN, ověřeno]** | ř. 507, `message_events` | `PARTITION BY RANGE (ts)`, tedy podle času události u providera | Po rozhodnutí o B12: `received_at`. Zdůvodnění v B12: `ts` je hodnota z cizího systému a událost mimo existující rozsah selže při vložení, protože výchozí partition nemáme | VÁŽNÉ |

Podle **[PŘÍMO]** má část 4a zapracovaných všech pět oprav outboxu, přestala opisovat DDL, přejmenovala 21 indexů a constraintů a zrušila pět vlastních chybových kódů ve prospěch obecných.

Zbytek se doplní z auditu.

### 3.4 Část 4b (sender)

**Autor si mezi skenem a odevzdáním opravil čtyři z pěti mých původních nálezů sám** a přidal do dokumentu porovnávací tabulku svých předpokladů proti kontraktu. Zbyl jediný.

| ID | Místo | Co je špatně | Jak má být | Závažnost |
|---|---|---|---|---|
| A-4b-1 **[SKEN, ověřeno]** | ř. 989, ukázka MIME hlaviček | `List-Unsubscribe: <https://app.example.com/u/t1.AbCdEf...>` používá starý tečkový tvar tokenu | Kontrakt 4.10.3: `"t1"` a hned base64url, bez tečky. Živý text i tabulka předpokladů jsou už opravené, zůstala jen tahle ukázka | DROBNÉ |

Historická tabulka předpokladů (P5.3, P5.5 kolem ř. 1892) tečkový tvar a zkrácený `info` string pořád uvádí, ale to je záznam o tom, co autor předpokládal **před** vydáním kontraktu, a je správné, že tam zůstal. Není to nález.

### 3.5 Část 5 (tracking)

**Autor přepsal dokument o tisíc řádků a formát tokenu i katalog chyb sladil s kontraktem.** Zbyly dva rozpory uvnitř jeho vlastního dokumentu, a jeden z nich je vážný.

| ID | Místo | Co je špatně | Jak má být | Závažnost |
|---|---|---|---|---|
| A-5-1 **[SKEN, ověřeno]** | ř. 2406, **akceptační kritérium** v sekci 10 | Akceptační kritérium tvrdí, že implementace vyrobí řetězec `t1.AQABmPPCG356QZw9Xm9wgZorAZjzwAAAcACAAAAAAAAKvGpuGAA.tVYncCLvXZ_XzZyO4n67gQ`, tedy **starý tečkový tvar se dvěma tečkami**. Sekce 4 téhož dokumentu (ř. 583) přitom správně uvádí `"t1" \|\| base64url_nopad(...)` | Přepsat akceptační kritérium podle kontraktu. **Tohle je nejnebezpečnější nález celé revize:** akceptační kritérium je to, z čeho se píše test. Kdo bude implementovat podle něj, vyrobí tokeny, které aplikace neověří, a test mu to potvrdí jako správné | **BLOKUJÍCÍ** |
| A-5-2 **[SKEN, ověřeno]** | ř. 720, ukázka open pixelu | `<img src="https://events.example.cz/t/o/t1.AQAB....tVYn...gQ">` tentýž starý tvar | Opravit ukázku | DROBNÉ |
| A-5-3 **[SKEN, ověřeno]** | ř. 1240 | „Algoritmus token bucket z části 1" | Konvence 4.5 je **posuvné okno s pevnými sloty**, ne token bucket. Autor to na ř. 211 správně uvádí jako převzaté, ale na ř. 1240 zůstal starý text. Rozpor uvnitř jednoho dokumentu | DROBNÉ |
| A-5-4 **[SKEN, ověřeno]** | ř. 555, `proxy_ranges` | `id bigserial PRIMARY KEY` | Stejný případ jako A-2-1. **Stanovisko: výjimku uznat.** Je to interní cache stažených IP rozsahů, ID neopouští systém | DROBNÉ |

Vyřešeno mezitím: formát tokenu v živém textu, HKDF salt a `info` string, katalog chyb přepsaný na RFC 9457, `crypto/hkdf` ze stdlib. Ověřený testovací vektor `K_tracking-token` v jejich dokumentu **souhlasí s mým**. (Poznámka z 2026-07-31: po přejmenování produktu se domain separator řetězce přesunuly na `mailer/...` a všechny vektory se přepočítaly, aktuální hodnota je `b9d815e1...ac3124`.)

### 3.6 Část 6 (UI a UX)

| ID | Místo | Co je špatně | Jak má být | Závažnost |
|---|---|---|---|---|
| A-6-1 **[ORCH]** | tabulky a seznamy | Číslované stránkování a všude přesné počty | Nesplnitelný předpoklad nad kurzorovým stránkováním. Po rozhodnutí o B4: předchozí a další plus samostatný endpoint s `precision` | BLOKUJÍCÍ |

Zbytek se doplní z auditu.

### 3.7 Nálezy, které se mezi skenem a odevzdáním vyřešily samy

Uvádím, aby bylo dohledatelné, proč zmizely, a aby je nikdo neobjevil znovu.

| Původní nález | Část | Stav |
|---|---|---|
| Šestý stav `indeterminate` mimo kontraktní pětici | 4b | **Vyřešeno.** Zbyl jediný výskyt, a to v porovnávací tabulce s vysvětlením, že kontrakt řeší totéž bez šestého stavu |
| `golang.org/x/crypto/hkdf` | 4b | **Vyřešeno.** Dokument teď výslovně říká, že se `x/crypto` nepoužívá a stavíme na `crypto/hkdf` ze stdlib |
| Vlastní názvy `SENDER_CLAIM_TIMEOUT` a spol. | 4b | **Vyřešeno.** Používá `SENDER_CLAIM_TTL_SECONDS` a nově navrhuje `SENDER_DISPATCH_TIMEOUT_SECONDS` (int, výchozí 10, meze 1 až 300) s invariantem `SENDER_CLAIM_TTL_SECONDS > 4 × SENDER_DISPATCH_TIMEOUT_SECONDS`. **Přebírám do 4.9**, je to dobře navržené |
| Obálka chyb `{ "error": { ... } }` | 5 | **Vyřešeno**, katalog chyb přepsaný na RFC 9457 |
| `golang.org/x/crypto/hkdf` | 5 | **Vyřešeno** |
| HKDF `salt = "mailer.tracking.v1"` s epochou v `info` | 5 | **Vyřešeno**, přepsáno na kontraktní tvar |
| Vlastní layout tokenu `t1.<payload>.<tag>` s MAC nad ASCII | 5 | **Vyřešeno v živém textu**, zbyly dvě ukázky a jedno akceptační kritérium, viz A-5-1 a A-5-2 |

---

## 4. Kategorie C: nedorozumění, stačí upřesnit text

| ID | Kdo | Co | Kde upřesnit |
|---|---|---|---|
| C1 **[PŘÍMO, 3]** | část 3 | Práh automatické pauzy „5 % z prvních 1000 zpráv" se u kampaně na 200 příjemců nikdy nespustí | Moje 4.10.2. Návrh: „5 % z prvních `min(1000, velikost_publika)` zpráv **a zároveň** alespoň 10 selhání". Druhá podmínka je kvůli opačné hraně, u kampaně na 20 příjemců by jinak jedno selhání znamenalo 5 % a zastavilo kampaň |
| C2 **[PŘÍMO, 3]** | část 3 | Manifest zálohy neříká, že při `STORAGE_DRIVER=s3` obrázky v `uploads.tar.gz` nejsou | Moje 3.14. Návrh: `uploads.driver` a `uploads.included` v manifestu **a výpis na konzoli při každém běhu zálohy**. Záznam v souboru, na který se nikdo nedívá, tenhle problém neřeší, protože se projeví až při obnově |
| C3 **[PŘÍMO, 3]** | část 3 | Entrypoint musí před spuštěním web a worker vymazat AI klíče z prostředí. AI SDK při `apiKey: undefined` tiše sáhne po proměnné prostředí, takže projekt bez nakonfigurovaného klíče utrácí peníze provozovatele | Moje 3.12. Mazat **podle vzoru, ne podle výčtu**, aby nový provider nepropadl, plus test se podvrženými proměnnými. Je to nejlepší nález mimo kategorii B a je na mém území |
| C4 **[PŘÍMO, 4a]** | část 4a | `provider_quota_exceeded` si nechává místo obecného `quota_exceeded` | Souhlasím, argument sedí: obecný kód vede uživatele k „mám upgradovat", tenhle k „požádej AWS o zvýšení". Jen `remaining` a `reset_at` patří jako rozšiřující pole na kořen problem objektu, ne do `errors[]`, které je pro validační chyby |
| C5 **[PŘÍMO, 4a]** | část 4a | `MESSAGE_RETENTION_DAYS` naznačuje denní granularitu | Retence u partitionovaných tabulek se dělá odpojením partition, takže reálná granularita je **měsíc**. Hodnota 90 drží 90 až 120 dní. Doplnit do 2.1 i do jejich dokumentu |
| C6 **[SKEN, 2]** | část 2 | Žádá doplnit `/s/c/**`, `/p/**`, `/r/**` mezi veřejné cesty | Moje 4.1. Oprávněné: potvrzení přihlášení, stránka preferencí a reaktivační odkaz jsou veřejné cesty s podepsaným tokenem, bez doplnění by spadly pod CSRF a session ochranu a přestaly fungovat |

---

## 5. Kategorie D: mezery, nevlastní to nikdo

| ID | Mezera | Návrh vlastníka | Proč |
|---|---|---|---|
| D1 | **Sdílená utilita na SSRF blocklist.** Dnes ji implicitně mají dvě části, každá po svém | část 1 | Viz B11. Blocklist rozsahů je infrastruktura, ne doména |
| D2 | **Ochrana partition s rozpracovanou kampaní před retenčním jobem.** Vyplývá z B6, dnes to nehlídá nikdo | část 1 (job) ve spolupráci se 4a (definice „rozpracované") | Retenční job je moje infrastruktura, ale „kampaň není v koncovém stavu" umí vyhodnotit jen část 4a |
| D3 | **Pravidlo, že `SECRET_KEY_PREVIOUS` se nesmí nikdy vyprázdnit.** Dnes to je jen v prozaickém doporučení u trackovacích tokenů | část 1 | Viz B3. Musí to být tvrdé pravidlo v `mlain doctor`, jinak si to někdo při rotaci vyloží jako úklid |
| D4 | **Definice, co je zdroj pravdy pro doručení versus pro předání provideru.** Dnes to nikde není napsané a první report to udělá špatně | část 1 (kontrakt), konzumuje část 5 | Viz B2 |
| D5 | **Parametrizace `createMonthlyPartitions` na jiný sloupec než `created_at`.** Helper to dnes neumí, přitom `sns_events` legitimně partitionuje podle `received_at` | část 1 | Vyplynulo z B12 |

---

## 6. Co je napříč všemi šesti dokumenty čisté **[SKEN]**

Uvádím schválně, aby orchestrátor nemusel tyhle věci ověřovat znovu.

| Kontrolovaná věc | Výsledek |
|---|---|
| Nativní `CREATE TYPE ... AS ENUM` | žádný výskyt |
| Redis nebo Valkey v MVP 0 | žádný. Všechny čtyři zmínky jsou explicitní odmítnutí |
| Offsetové stránkování (`per_page`, `?page=`, `total_count` v seznamu) | žádné. Výskyty `total_count` v části 4a jsou materializované čítače na kampani, ne stránkování |
| Prefix `ML_` u proměnných prostředí | žádný. Nálezy v grepu jsou HTML marker `<!--ML_OPEN_PIXEL-->` |
| Copyleft závislosti | žádná propuštěná. `czech-inflection` (LGPL 2.1), `jschardet` (LGPL 2.1+), `pa11y` (LGPL 3.0-only) i TinyMCE a CKEditor jsou všude označené jako zakázané, `axe-core` (MPL-2.0) správně jen jako vývojová závislost |
| Definice tabulek vlastněných částí 1 v cizích částech | žádná |

---

## 7. Co v tomhle dokumentu ještě chybí

Poctivě, aby na to orchestrátor nespoléhal:

1. **Seznamy kategorie A po částech nejsou úplné.** Doplní se z auditů, které v okamžiku odevzdání ještě běžely. To, co tu je, pochází z mého mechanického skenu a z přímých zpráv autorů, tedy z ověřených zdrojů.
2. **B9 čeká na ověření důkazu** v sekci 3.4.3 dokumentu části 4b. Nepředkládám ke schválení něco, co jsem nedočetl.
3. **A-5-3 vyžaduje ověření**, o kterou tabulku na řádku 529 jde.
4. **Kompletní seznam navržených knihoven napříč částmi** s licencemi se doplní z auditů. Mechanický sken potvrdil, že nic zakázaného neprošlo, ale úplný soupis zatím nemám.

---

## 8. Doporučené pořadí rozhodování

Body nejsou nezávislé. Navrhuju rozhodovat v tomhle pořadí:

1. **B2** (je `sent` koncový). Ovlivňuje stavový automat, reporty i dashboard, a části 4a a 5 na něm staví.
2. **B6, pak B1** v tomhle pořadí. B6 je předpoklad toho, aby B1 vyšlo bez růstu tokenu.
3. **B12** (partitioning podle `received_at`). Ovlivňuje DDL části 4a, čím dřív, tím levněji.
4. **B4** (stránkování a počty). Blokuje část 6.
5. **B3** (suppression fingerprinty). Blokuje část 2.
6. **B5, B7, B8, B11.** Malé, nezávislé, dají se schválit hromadně.
7. **B10** k zamítnutí, **B9** až po dokončení auditu.

Po rozhodnutí provedu všechny schválené změny v části 1 **v jednom průchodu** a přepočítám testovací vektory pro tokeny, kterých se dotkne B1.
