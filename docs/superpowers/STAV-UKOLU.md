# Stav úkolů

> **ARCHIV HOTOVÉ PRÁCE: [`docs/superpowers/HOTOVO.md`](HOTOVO.md)**
>
> Přečti si ho DŘÍV, než začneš cokoli opravovat. Je v něm zapsané, co se už jednou
> naměřilo a proč se to udělalo tak, jak se to udělalo. Bez toho se tytéž nálezy
> vracejí znovu a řeší se podruhé, často hůř.

Živý dokument. Vede ho hlavní agent, prochází ho po každém dokončeném úkolu
a po každém novém zadání. **Nic se nesmí ztratit tím, že to zapadne v konverzaci.**
Drží JEN to, co je potřeba udělat, zadat nebo rozhodnout. Hotové sem nepatří.

Poslední aktualizace: 2026-08-07, 19:15

Stav k této chvíli: **5 otevřených nálezů** v oddílu 4 (ráno jich bylo 39),
23 položek čeká na zadání v oddílu 2, 8 na rozhodnutí zadavatele v oddílu 3.
**Neběží žádný subagent.**

**Celý repozitář je zelený, ověřeno 7. 8. v 19:00:** 27 z 27 úloh turba (testy
i typecheck), oxlint, eslint i prettier bez nálezu. Sada se musí pouštět
`--concurrency=1`; při dvou balíčcích naráz jednou spadl ÚKLID testů na `57P01`
(přeťaté spojení při vypínání kontejneru). Web sám o sobě i celá sada v řadě
za sebou projdou čistě, takže je to souběh v testovací infrastruktuře, ne v produktu.
**Nedohledané.**

Agent `provoz-nalezy` zavřel 7. 8. čtyři provozní nálezy (údržba oddílů v dodávané
instalaci, hlídání ověřování záloh, retence úloh, chybný krok R2/4 v plánu systémové
pošty) a přidal dva nové, oba menší; rozbory jsou v `HOTOVO.md`.

### Zapamatovat: ODESLANÁ POŠTA SE OVĚŘUJE NA BĚŽÍCÍM SYSTÉMU, ne testy

Dvě vady 7. 8. odpoledne shodně způsobily, že **přihlášení přes formulář nedošlo
nikdy**, a ANI JEDNA se v testech neprojevila:

1. `outbox.reconcile` rušila potvrzovací e-mail dvojího souhlasu. Ten jde z definice
   na kontakt ve stavu `unconfirmed`, takže podmínka `c.status <> 'active'` sedla
   vždycky. Nevypadalo to jako chyba: řádek v `messages` existoval a nesl věrohodný
   důvod `contact_status_changed`. Test rekonciliace měl devět případů na to, co
   zrušit MÁ, a ani jeden na druh zprávy.
2. **Sender běžel z binárky staré tři dny**, tedy bez opravy `sending_enabled`.

Z toho plyne pravidlo pro každé další zadání kolem odesílání: **po zásahu do
`packages/core` přelož a restartuj worker, po zásahu do `apps/sender` přelož
a restartuj sender, a teprve pak něco tvrď.** Zelená sada o běžícím systému
neříká nic. Stejný nález nahlásil nezávisle agent `ruseni-zprav` u produkčního
buildu webu (`.next` byl ze 3. 8.).

Pravidla vedení:

- Hotové se **neškrtá pryč**, přesune se do `HOTOVO.md` s datem a se způsobem
  ověření. Historie je součástí ceny.
- Co přibude v konverzaci, se sem zapíše **hned**, ne až se to začne dělat.
- U každé položky musí být vidět, **kdo ji drží** a **co brání dokončení**.
- Úkol bez vlastníka patří do „Čeká na zadání", ne do „Probíhá".

---

## 1. Probíhá (běžící subagenti)

**Žádný k 7. 8. 2026, 19:15.** Všichni dokončili a jsou uzavření; jejich výstupy jsou
v `HOTOVO.md`. Poslední byl `ruseni-zprav` (ověření rušení pošty naostro přes trasu
`/u/[token]` a přesun retence auditu na odpojení oddílu).

**Pravidlo, které dnes stálo dvě ztracené hodiny a platí pro každé zadání:** report agenta
musí přijít přes `SendMessage` adresátovi `main`, prostý text v odpovědi se k hlavnímu
agentovi NEDOSTANE. A druhé, tvrdší: **odpověď se vyžaduje ke KAŽDÉ položce zvlášť.**
Dnes se třikrát stalo, že souhrnný report vypadal hotově a pozdější zadání v něm tiše
chybělo; pokaždé se to zjistilo až kontrolou v kódu, ne z reportu.

---

## 2. Čeká na zadání (rozhodnuté, nezačaté)

### 2.1b Vlastní stránky ve VKLÁDANÉM formuláři (nález agenta `seznamy-nastaveni`)
Přesměrování po odeslání formuláře funguje jen u odpovědi 303, tedy u hostované stránky
`/f/{ref}` a u čistě HTML formuláře. **Vkládaný skript posílá JSON**, dostane 200 a vypíše
svou hlášku, takže se nepřesměruje ani na `forms.redirect_url` (to platilo i před 7. 8.),
ani na novou `lists.already_subscribed_redirect_url`. Kdo si vlastní stránku nastaví
a formulář má vložený skriptem, nepozná, proč se nic neděje.

- [ ] Skript (`features/public/embed-script.ts`) by musel adresu dostat v těle odpovědi a sám
  provést `window.location`. Je to ale právě ten rozdíl v odpovědi, kvůli kterému je funkce
  „už jste přihlášeni" vypnutá, dokud si ji správce nezapne (jednotná odpověď, rozhodnutí R9),
  takže se adresa smí posílat JEN tehdy, když je vyplněná
- [ ] Rozhodnutí zadavatele: má se to týkat jen stránky pro už přihlášeného, nebo i běžného
  `redirect_url` formuláře? Druhá varianta je větší změna chování vloženého formuláře

### 2.1c Správa vlastních polí: co obrazovka zatím neumí (nález agenta `kontakty-zbytky`)
Obrazovka `/settings/fields` od 7. 8. existuje a umí NUTNÉ MINIMUM: vypsat, založit,
přejmenovat, archivovat i smazat (viz oddíl 6). Zbytek toho, co API umí, ovládání nemá.
**Není to chybějící trasa, je to chybějící ovládání**, takže se to dá udělat po částech.

- [ ] **`ConfirmDialog` kreslí potvrzení vždy červeně** (`variant="destructive"` natvrdo
  v `packages/ui/src/patterns/feedback/confirm-dialog.tsx`), takže i „Archivovat pole" a
  „Archivovat seznam" vypadají jako mazání. Je to nález přes celou aplikaci, ne jen přes tuhle
  obrazovku: N2 okno u nedestruktivní akce si zaslouží tlačítko v barvě primární akce, aby
  červená zůstala rozlišovacím znakem mazání. **ROZHODNUTO 7. 8.: ZADÁNO K OPRAVĚ** (agent
  `potvrzeni-barva`). Když vypadá nebezpečně všechno, přestane červená znamenat cokoli
- [ ] **Přepínač zrychleného hledání.** `/contact-fields/{id}/index` existuje, sloupec
  „Zrychlené hledání" je jen k přečtení. Limit se přitom na obrazovce vypisuje, takže
  uživatel vidí strop u věci, kterou nemůže ovládat
- [ ] **Pole typu `enum` a `multi_enum` nejde založit.** Dialog je nenabízí schválně: bez
  seznamu povolených hodnot je takové pole k ničemu a přidávání hodnot je samostatný ovládací
  prvek. Založit je jde zatím jedině přes API

### 2.1d Oslovení a pátý pád musí jít celé vypnout (přesunuto 7. 8. z oddílu 1)
Zadání zadavatele 5. 8.: v angličtině se pátý pád neřeší, musí jít vypnout jedním přepínačem
a pak se nesmí objevit nikde. Mapa: `docs/superpowers/specs/2026-08-05-osloveni-vypinac.md`.
Dotčeno 102 souborů mimo testy. Přepínač `workspaces.greeting_enabled` (migrace 0020) nasazený je.

- [ ] Etapa 2, implementace
- [ ] **Nejnebezpečnější místo:** šablona s oslovením by se po vypnutí **nedala odeslat vůbec**,
  protože neznámé pole je chyba, ne varování. Řeší se příznakem vyřazeného pole v katalogu, který už existuje
- [ ] Na obrazovku kontroly pátého pádu vede **pět cest**, ne jedna, všechny musí zmizet
- [ ] Tykání a vykání vypíná týž přepínač (má v repozitáři jediného konzumenta, samostatný by byl bez následku)
- [ ] **ROZHODNUTÍ ZADAVATELE ze 7. 8., závazné pro celou etapu: vypnutí se NESMÍ povést potichu.**
  Když je pátý pád použitý v nějaké šabloně, musí aplikace vypnutí ODMÍTNOUT, vyjmenovat ty
  šablony a vyzvat uživatele, ať to nejdřív opraví. Tím padá dosud plánované řešení „příznakem
  vyřazeného pole v katalogu", které vypnutí umožňovalo a šablonu jen tiše vyprazdňovalo.
  Nové řešení potřebuje projít VŠECHNY šablony projektu a najít v nich `contact.greeting`
  a pole pátého pádu, tedy i pracovní kopie kampaní, ne jen knihovní šablony

### 2.1e Hledání ve štítcích (přesunuto 7. 8. z oddílu 1)

- [ ] Zadavatel zatím nechce. Seznam bere prvních 200 a o dalších jen řekne větou

### 2.2 SYSTÉMOVÁ POŠTA PŘES SES — čtyři zadané položky hotové 7. 8. 2026, doladění zbývá
Plán: `docs/superpowers/plans/2026-08-05-systemova-posta-ses.md`.
Body 1 až 5 z kapitoly 3 plánu jsou hotové (agent `systemova-posta`). Bez migrace,
bez zásahu do Go senderu, bez nové závislosti, přesně jak plán počítal.

Zbývá doladění (body 6 až 10 plánu):
- [ ] Zašedlý formulář pozvánky v Nastavení → Tým místo chyby až po odeslání
- [ ] Neutrální, ale pravdivá odpověď formuláře obnovy hesla, když instalace nemá účet
- [ ] Jméno projektu a instalace v textech systémových zpráv
- [ ] Job `platform.system_mail_send` pro dvě informační zprávy
- [ ] Volba „projekt systémové pošty instalace" na obrazovce; klíč `systemMail.workspace_id` už existuje a obrazovka do něj jen začne psát
- [ ] **RZ2, nedořešeno vědomě:** SES odmítne `From`, které nemá ověřenou identitu. Adresa z `APP_URL` (`from_source = 'app_url'`) u účtu typu SES skončí chybou `MessageRejected`. Blokovat to dopředu jsem NEUDĚLAL, protože identita může být ověřená v AWS mimo naši databázi (jednotlivá adresa místo domény) a blokace by shodila i odeslání, které by prošlo. Chyba se dnes aspoň pozná: kód nese jméno výjimky AWS

Dnes si `mlain partitions` nikam nezapisuje, že proběhl, takže provozovatel nepozná,
že týden neběžel a data leží přes lhůtu. Migrace není potřeba: `audit_log.workspace_id`
je nullable a `actor_type = 'system'` je povolený.

**Není to vada, je to nedodaná schopnost**, a proto to je tady, ne mezi nálezy. Přesunuto
z otevřených nálezů 7. 8. agentem `fronty` i s měřením, o co přesně jde.

Co UŽ JE: `/api/v1/jobs` a `/api/v1/jobs/{kind}/{id}` vracejí skutečná data, protože se
7. 8. zapojily zdroje úloh (import a stavba publika kampaně). Komponenty `JobsCenter`
i `JobsBadge` existují v `packages/ui/src/patterns/jobs/` včetně testů.

Co CHYBÍ: v `apps/web/src` **není ani jeden soubor, který by je použil** (ověřeno greppem
7. 8., nula výskytů `JobsCenter` i `JobsBadge`). Adresář `jobs` v routách webu není.

Nadpis tohohle oddílu 7. 8. z dokumentu zmizel při souběžné úpravě sousedního 2.2c
(spolu s jeho odrážkami); text pod ním zůstal viset bez hlavičky. Vrácen zpátky.

**Vylepšení, ne díra**, a proto tady. Přesunuto z otevřených nálezů 7. 8. agentem `fronty`.
Dnešní hlídač (`apps/worker/src/cron-watch.ts`) chytí frontu, která drží nedokončený tik
déle, než je její expirace. Nechytí opačný případ: fronta, do které se **netiká vůbec**,
protože se zasekl plánovač. V tabulce úloh po ní nic nezbude, takže není co měřit.

Chce to počítat periodu z výrazu cronu a hlásit frontu, jejíž poslední úloha je starší než
násobek té periody. **Pozor na dvě pasti:** cronové fronty bez obsluhy se od 7. 8. schválně
neplánují (viz oprava v `registerQueues`), takže je musí hlídač vynechat, jinak bude hlásit
záměr; a čerstvě nasazená instalace nemá úlohy žádné, což není porucha.

### 2.3 Automatizace (P17) — plán hotový, čtyři blokující otázky zodpovězené
Plán: `docs/superpowers/plans/2026-08-05-p17-automatizace.md`
plus 2 dny na rozepsání do úkolů. **Zadavatel zatím nedal pokyn začít.**

- [ ] Rozepsat plán do úkolů (bez toho fáze A nezačne)
- [ ] O2 z plánu: pozastavení skryté kampaně ve stavu `draft`. Samostatná oprava **před vydáním**, zavírá tutéž díru i u e-mailů z formulářů

### 2.5 Mřížky s tvrdým minimem přetékají na úzkém displeji — HOTOVO 7. 8.

> **Přepsáno 7. 8. jedním průchodem, 25 výskytů** (agent `mobil-skorapka`). Zápis
> s odůvodněním je v `HOTOVO.md`. Nahradil se jen tvar `repeat(auto-fit,…)`; tři PEVNÉ
> mřížky editoru zůstaly schválně, `min()` by u nich nic neřešilo a rozbilo by je.
> V repozitáři už tvrdé minimum mimo editor není.
>
> Kontrola, jestli se vzorec nevrátil:
> `grep -rn "minmax([1-9]" apps/web/src packages/ui/src --include="*.tsx" | grep -v "minmax(0" | grep -v "minmax(min("`

### 2.6 Vykreslení stránky přes vlastní HTTP API (přesunuto 7. 8. z oddílu 4)
**Není to vada, je to strop rychlosti.** Nález agenta `filtr-kontaktu`, rozbor agenta
`posledni-nalezy` ze 7. 8. Změřený medián stránky 245 až 282 ms, z toho databáze 1,2 ms.

Jak to dnes chodí: `apiFetch` a `apiMutate` jsou `server-only` a jdou přes skutečný `fetch`
na `http://127.0.0.1:${PORT}` (`lib/api-client/base-url.ts`). Ke každému požadavku se skládá
hlavička z `cookies()` a `headers()` (`lib/api-client/fetch.ts:28`) a Hono aplikace
(`lib/api/openapi.ts` → `buildApp()`, mountnutá v `app/api/v1/[[...route]]/route.ts`) si
relaci ověří znovu. Přímých volajících `apiFetch(` je v `apps/web/src` **14**, ale jedna
obrazovka jich zavolá víc a k tomu `apiMutate`.

**Doporučená varianta: volat Hono aplikaci v procesu, ne přímo doménu.**

- [ ] **PROČ NE přímé volání `packages/core`.** HTTP vrstva neobstarává jen přenos: ověření
  relace, sestavení `WorkspaceContext`, `assertPermission` u každé cesty, validaci zod,
  převod chyb na RFC 9457 a presentery na DTO. Volající v Next.js by si to musel udělat sám,
  tedy zdvojit kontrolu oprávnění mimo místo, kde se dnes hlídá. Vzniknou dva zdroje pravdy
  a kontrakt OpenAPI přestane popisovat, co se doopravdy děje. **Bezpečnostní riziko převažuje
  nad ziskem.**
- [ ] **Střední cesta: `buildApp().request(url, init)` v procesu.** Ušetří TCP kolo na loopback
  a parsování HTTP, přitom NEOBEJDE autentizaci, validaci ani převod chyb, takže se nemění
  ani jediné pravidlo. `buildApp` je běžný export, ze serverové komponenty dosažitelný.
  Pozor: aplikace se dnes skládá líně a cachuje se v modulu route handleru, takže druhý
  volající si ji nesmí postavit znovu
- [ ] **Nejmenší první krok s měřitelným ziskem, udělat ho dřív než cokoli výš:** ověřit
  relaci JEDNOU za vykreslení, ne šestkrát. Šest volání dnes znamená šest ověření téže cookie
  proti tabulce `sessions`. React `cache()` na tu jednu funkci je pár řádků a nesahá na
  architekturu. **Nejdřív to změřit**, protože z 245 ms zatím nikdo nerozpadl, kolik padne
  na ověření a kolik na režii HTTP
- [ ] Odhad: měření a `cache()` půl dne; `app.request()` v procesu 1 až 2 dny včetně testů;
  přímé volání domény se nedoporučuje vůbec

### 2.7 Webhooky `message.delivered`, `bounced` a `complained` (přesunuto 7. 8. z oddílu 4)
**Rozhodnutí agenta `posledni-nalezy` ze 7. 8.: NENÍ to práce na dnešek, a důvod je jiný,
než nález tvrdil.** Nález říkal, že infrastruktura je hotová a chybí jen vydání tří událostí.
Chybí ale i to, z čeho by se vydávaly.

Co je ověřené v kódu:

- **NEPLATÍ OD 7. 8.: katalog typů událostí UŽ EXISTUJE**, a je uzavřený. Původní věta zněla,
  že `event_types` je pole volných řetězců bez validace, takže nový typ neprojde ničím, co by
  se muselo rozšiřovat. Od zavedení `packages/core/src/platform/webhooks/event-catalog.ts`
  to je naopak: **nový typ se musí zapsat do katalogu**, jinak si ho nikdo nemůže odebrat,
  a shodí to `event-catalog.test.ts`, který katalog porovnává s místy vydání. Je to práce na
  dva řádky (položka v katalogu, popis v `packages/i18n/messages/{cs,en}/settings.json` pod
  `webhooks.events`), ale zapomenout se nedá
- **Doručení, odraz ani stížnost se dnes NEZAZNAMENÁVAJÍ.** `message_events` typu `delivered`,
  `bounced_hard`, `bounced_soft` a `complained` mají v repozitáři jen ČTENÁŘE (přehled kampaně,
  segmenty, časová osa). Jediný zapisovatel by byl příjem událostí od poskytovatele, a ten
  není zapojený: `setSnsWebhookDeps` nikdo nevolá a fronta `provider_event.process` nemá
  obsluhu (řečeno přímo v `providers/api/sns-webhook.ts:28` a v `tracking/jobs/queue-handlers.ts:77`)
- Vydání události je proti tomu triviální: `emitWebhookEvent` plus zařazení
  `platform.webhook_fanout`, přesně jak to dělá `tracking/jobs/process-engagement.ts:375`

- [ ] **Skutečný úkol je příjem událostí od SES přes SNS, ne tři webhooky.** Ty jsou pak
  několik řádek na konci téže obsluhy
- [ ] **Past, která je v kódu už zapsaná (riziko RZ3):** událost ke zprávě, která v `messages`
  řádek nemá (systémová pošta, protože příjemce není kontakt), se musí ZAHODIT, ne shodit
  dávku. Systémová cesta ani neposílá tagy `ml_msg`, takže taková událost nenese identifikátor
- [ ] **Idempotence:** poskytovatel tutéž událost pošle víckrát. `process-provider-events.ts:35`
  s tím počítá u počítání (`delivered` je počet ZPRÁV, ne událostí), u vydání webhooku to musí
  platit taky, jinak zákazník dostane doručení třikrát
- [ ] Odhad: příjem a zpracování 2 až 3 dny, tři webhooky nad hotovým příjmem půl dne

### 2.8 Mobilní podoba obrazovek — mapa po opravě skořápky (agent `mobil-skorapka`, 7. 8.)

**Skořápka je hotová** (zápis v `HOTOVO.md`): pod 768 px není boční menu v rozvržení,
otevírá se tlačítkem, hlavní sloupec má na telefonu celých 375 px místo 269 px a na
390, 768 i 1024 px se dokument neposouvá do strany na 19 měřených adresách.
**Tenhle oddíl je zbytek**, tedy obsah obrazovek. Seřazeno podle toho, jak často se
obrazovka používá a jak moc je rozbitá; čísla jsou měřená 7. 8. na 390 px po opravě skořápky.

> **Karty v `DataTable` hotové 7. 8.** Zadavatel je odblokoval a jsou udělané: pod 768 px
> se řádek kreslí jako karta, virtualizace se tam vypíná (jinak se karty překrývaly a text
> ležel přes text) a role sloupců rozhoduje jedna funkce pro všechny tabulky. Platí to na
> Kontakty, Kampaně, Formuláře, Seznamy, Zablokované adresy, Vlastní pole i Přepisy jmen.
> Segmenty mají vlastní tabulku a dostaly totéž zvlášť. Zápis s čísly v `HOTOVO.md`.
>
> **Zbývají dvě obrazovky s VLASTNÍ tabulkou, které `DataTable` nepoužívají**: Šablony
> (`min-w-[900px]`) a Štítky. Na 390 px na nich pořád zůstává vodorovný posuv uvnitř rámu.
> Je to táž práce jako u Segmentů, tedy zalomit řádek na dva sloupce a pustit minimální
> šířku až od `md`.

**Nejdřív rozhodnutí, které jsem nechal na tobě:**

- [ ] **Které sloupce mají být na kartě u KAŽDÉ tabulky.** Dnes o tom rozhoduje výchozí
  pravidlo: první sloupec je hlavní údaj, nabídka řádku zůstává, další nejvýše tři jsou
  doplňkové a zbytek se na kartě nekreslí. U Kontaktů z toho vyjde e-mail, jméno, oslovení
  a stav, což je obhajitelné, ale je to odvozeno z pořadí sloupců, ne z rozhodnutí o obsahu.
  Obrazovka to umí přebít hodnotou `mobile` u sloupce (`primary`, `secondary`, `actions`,
  `hidden`), takže je to na jeden řádek u každé tabulky. **Potřebuju od tebe vědět, co je
  na telefonu hlavní údaj u Kampaní** (dnes název, ale možná stav), a jestli u Kontaktů
  nemá být místo oslovení vidět datum přidání

**Obrazovky, každá vlastní zadání:**

- [ ] **1. Editor kampaně — jediné místo, které přetéká i na 1024 px.** `min-w-[1140px]` na
  třísloupcové mřížce (paleta bloků 220 px, plátno 360 px, vlastnosti), `scrollWidth` 1231 px
  na 390 px a 1416 px na 1024 px. Na telefonu se v něm nedá pracovat vůbec. Je to největší
  kus práce z celého seznamu: tři sloupce se musí na úzkém displeji stát přepínanými panely
  (bloky / plátno / vlastnosti), ne zmenšit. **Rozhodnout se dá i to, že editor na telefonu
  nabídneme jen ke čtení** a psaní zůstane od tabletu výš; to je byznys rozhodnutí, ne technické
- [ ] **2. Kontakty a jejich detail.** Seznam čeká na rozhodnutí o `DataTable` výš. V detailu
  přetéká na 320 px nadpis s e-mailem (`h1` 315 px, dlouhý řetězec bez mezery se nezalomí):
  chce to `break-words` na nadpisu i na `p` s e-mailem pod ním. Na 390 px už detail v pořádku je
- [ ] **3. Přehled.** Karta posledních kampaní opravená 7. 8. skořápkou (dva sloupce pod 640 px),
  ale **pruh akcí panelu ukázkových dat přetéká na 320 px**: `ml-auto flex shrink-0 flex-wrap`,
  tedy zalomit se smí, zmenšit ne, a dvě tlačítka vedle sebe mají 286 px. `shrink-0` tam
  nepatří. Zbytek Přehledu je na 390 px v pořádku
- [ ] **4. Štítky: poslední vlastní tabulka, kterou karty minuly.** Obrazovka si kreslí seznam
  sama, takže na 390 px pořád roluje vodorovně uvnitř rámu (358 px rámu proti 520 px obsahu).
  **Práce je na jeden řádek** a dá se opsat ze Segmentů nebo Šablon, kde je hotová: v konstantě
  `COLUMNS` v `features/contacts/tags-screen.tsx` nahradit prostřední pevných `160px` za `auto`
  a od `md` vrátit původní tvar, plus pustit `min-w-[520px]` až od `md`. **Nesáhl jsem na to
  schválně**: soubor leží v `features/contacts`, kde v tu chvíli pracoval jiný agent,
  a jednořádková změna nestojí za konflikt v cizím souboru
- [ ] **5. Nastavení, Statistiky, Report kampaně, Import, Knihovna médií, Centrum úloh,
  Připravenost k odeslání.** Na 390 px měřeno bez přetečení. Potřebují revizi VZHLEDU, ne
  opravu rozvržení: dlaždice pod sebou, formulářové řádky na dva řádky, tlačítka přes celou
  šířku. Nižší priorita než všechno výš
- [ ] **Doladit stupnici, až budou obrazovky hotové.** Písmo a vnitřní okraje se od 7. 8.
  na úzkém displeji zmenšují přes tokeny (`tokens.css`, media query na 767 px). Hodnoty
  jsou první nástřel odvozený z měření, ne výsledek prohlídky obrazovku po obrazovce.
  Až se obrazovky přeuspořádají, projít je okem a stupnici dotáhnout. **Klikací plochy
  se přitom nesmí zmenšit**, jak to hlídá porovnání popsané v `HOTOVO.md`

---

## 3. Čeká na rozhodnutí zadavatele

> **Rozhodnuto 6. 8., `gdpr.erase` srovnán na registr** (3 pokusy, prodleva, dead letter).
> Nula pokusů **nechránila** před opakovaným výmazem, protože obsluha je prokazatelně idempotentní
> (`erase.ts:54`), jen ho uměla ztratit. **Zbývají čtyři fronty s rozdílem v počtu pokusů**,
> nejostřejší `contacts.bulk_delete` (nula pokusů u nevratného mazání). Ten je ale věcně jiný:
> neběží u něj zákonná lhůta a ztracená operace je vidět hned, protože u ní uživatel stojí.
> **Necháno, dokud nerozhodneš jinak.**

- [ ] **Má produkt sám upozorňovat na to, co dnes jde jen webhookem?** Devět typů události
  (`campaign.sending_started`, `campaign.sent`, `campaign.paused`, `campaign.resumed`,
  `campaign.schedule_missed`, `campaign.schedule_delayed`, `provider.status_changed`,
  `domain.verification_changed`) se vydává z úloh na pozadí, ale v rozhraní se o nich
  nikde nemluví. **O pozastavené kampani se dnes majitel dozví jedině tím, že si všimne**,
  nebo že si napsal vlastní webhook. Otázka je produktová, ne technická: mají aspoň ty
  důležité vyvolat i oznámení v aplikaci nebo e-mail? Přesunuto 7. 8. z otevřených nálezů,
  nález agenta `katalog-udalosti`

- [ ] **Kde rozjet testovací provoz na internetu.** Rešerše hotová: `docs/operations/2026-08-05-hosting-pro-testovani.md`. Zdarma Oracle Always Free (ARM, 12 GB) s rizikem, že si Oracle stroj vezme zpátky, nebo Hetzner za ~150 Kč měsíčně. **Hostované databáze zdarma nepoužívat**, Neon obchází RLS u rolí založených přes konzoli. Obraz si musíme sestavit sami, CI ho nepublikuje
- [ ] Kdy začít automatizace
- [ ] Úklid zkušebních dat v `mlain_clean` (nově i segmenty „ZK Neotevrel poslednich 5", „ZK Nikdy neklikl", „ZK Neaktivni 90"): kampaně „Odesilatel test A", „Kroky kampane test", „Slouceny krok 1", šablona „Slouceny krok 1 sablona", předvolba odesílatele „Fakturace", segment „Klikli v kampani Slouceny krok 1", kontakt `identify-dukaz@example.cz`
- [ ] **Úklid v `petr-osobni-mail`:** kontakt
  `petr.novak.dlouhy.testovaci@nejaka-hodne-dlouha-domena-na-test.example.cz`. Založil ho
  agent `mobil-skorapka` 7. 8., aby se dala ověřit karta s dlouhou adresou (na krátké se
  to ověřit nedá, ta se vejde vždycky). Smazat se ho nepodařilo: hromadné mazání ve
  sdíleném prohlížeči třikrát nedoběhlo, protože záložku průběžně přebíral jiný agent
- [ ] **Čtyři plány z 4. a 5. 8. neprošly recenzním procesem** podle `POSTUP-OPRAV.md`:
  editor WYSIWYG, e-maily seznamu, automatizace P17 a systémová pošta přes SES. Není to vada
  dokumentace, je to otázka, jestli u nich recenzi chceme, nebo jestli ten proces doběhl
- [ ] Strojově čitelné datum žádosti u omezení zpracování (dnes se bere z auditu, sloupec v `contacts` neexistuje)
- [ ] **Žlutá primární akce u samostatné šablony.** „Poslat test" tam bývalo žluté, po převodu na
  ikonu je tmavé, protože ikonové tlačítko žlutou variantu nemá. **Rozhodnuto nechat tmavé**
  (žlutá má znamenat hlavní akci obrazovky, ne se objevovat v řadě ikon). Zapsáno jako rozhodnutí,
  ne nedodělek
- [ ] **Hlavička editoru se pod 1400 px pořád láme do dvou řádků.** Nad tou šířkou drží jeden.
  Editor stejně roluje vodorovně kvůli vlastní minimální šířce, takže to nikdo neřešil

---

## 4. Otevřené nálezy bez vlastníka

- [ ] **Import hlásí víc zpracovaných řádků, než kolik jich soubor má.** Naměřeno 7. 8.
  na TŘECH dokončených importech v `mlain_clean`: `total_rows` 20 → `processed_rows` 25,
  3 → 4 a 1 → 2, přičemž `error_rows` i `skipped_rows` jsou všude nula. Uživatel proto
  v Centru úloh i v průvodci vidí „25 z 20", což je nesmysl na první pohled.
  **Rozdíl NENÍ konstantní** (+1, +1, +5), takže to není prostá záměna hlavičky za řádek.
  Podezření k ověření: `total_rows` se počítá z NÁHLEDU (možná ze vzorku), kdežto
  `processed_rows` sčítá `pending.length` po dávkách v `run-import.ts`. Zjistit, který
  z těch dvou lže, a srovnat je; číslo, které jde vidět, musí sedět na obsah souboru

### Nálezy ze 7. 8. 2026 (agent `centrum-uloh-2`, při měření fronty pro Centrum úloh)

- [ ] **`DataTable` kreslí zaškrtávátka vždycky a `selectable={false}` NEEXISTUJE.**
  Ověřeno ve zdroji `packages/ui/src/patterns/data-table/data-table.tsx`: `Checkbox` je
  na řádcích 405, 479 a 607 bez jakékoli podmínky, mezi propy nic takového není a táž
  věta stojí i v komentáři `lists-table.tsx`. Každá obrazovka bez hromadné akce tedy
  dostane výběr, který nikam nevede; od 7. 8. je mezi nimi i Centrum úloh, kde hromadná
  akce ani vzniknout nemůže (zastavit jde jen to, co jde zastavit, a u každého druhu
  jinak). Chce to nepovinnou propu `selectable` s výchozím `true`, aby se stávající
  tabulky nemusely měnit. Složka `packages/ui` byla dnes zabraná jinými agenty, proto
  jen zápis.

- [ ] **`platform.maintain_partitions` nemá obsluhu a testy jádra kvůli tomu PADAJÍ.**
  `packages/core/src/platform/jobs/jobs.test.ts` hlásí dvě selhání: „pro každou frontu
  platformy existuje modul na konvenční cestě" (chybí `platform/jobs/maintain_partitions.ts`)
  a „rejstřík queue-handlers pokrývá každou frontu platformy vlastněnou P04". Nález je
  MIMO zadání téhle práce a byl tam PŘED ní (adresář jsem si vypsal dřív, než jsem cokoli
  změnil), takže ho nechávám ležet, ale zelená série jádra bez něj neexistuje. Fronta má
  v registru cron, takže ji `registerQueues` schválně NEPLÁNUJE, a je jednou z osmi,
  které nově vidí panel Centra úloh jako „bez obsluhy".

- [ ] **Cronová fronta nemá dead letter, takže její selhání nikde nezůstane, a je jich
  hodně.** V `mlain_clean` má `outbox.reconcile` **4 116 selhaných běhů** a nikde po nich
  není stopa, na kterou by se dalo kliknout: 24 cronových front v registru má
  `deadLetter: false`. U úklidu, který se za hodinu zopakuje, je to správně a měnit se to
  nemá; u `campaign.scheduler` a `outbox.reconcile` to ale znamená, že se trvale
  nedaří odeslat naplánovanou kampaň a jediná stopa je řádek v logu workeru, do kterého
  se nikdo nedívá. **Panel Centra úloh to od 7. 8. aspoň POČÍTÁ** (dlaždice „Selhalo"),
  takže se na to přijde; co se s tím má dělat dál, je rozhodnutí vlastníka domény.
  Konkrétní příčina těch 4 116 běhů je ve vývojové instalaci **chybějící
  `DATABASE_URL_MAINTENANCE`**, na což worker při startu upozorňuje, takže to není vada
  produktu; vada je, že se to nikde neprojeví.

- [ ] **`pgboss.queue_stats` je prázdná a její oddíly končí 4. 8.** Tabulka vypadá jako
  správný zdroj historie fronty, ale ukládání snímků je v pg-bossu volitelné
  (`persistQueueStats`) a worker si ho nezapíná. Kdo se na ni v budoucnu spolehne,
  dostane nuly a bude si myslet, že měří. Buď snímky zapnout (a mít historii pro graf
  zátěže), nebo tabulku nechat být a vědět proč.

> **Retence úloh: NENÍ co dělat, uzavřeno 7. 8. agentem `provoz-nalezy`.** Zadání téhle
> práce ji ještě neslo jako otevřenou položku, ale rozhodnutí už padlo a je podložené
> schématem (`campaign_audience_progress` má řádek na kampaň s kaskádou,
> `imports` jsou jednotky až stovky řádků ročně a osobní data z nich mizí po 30 a 90 dnech).
> Rozbor je v `HOTOVO.md`.

> **Limit 50 nejnovějších úloh: VYŘEŠENO 7. 8.** Nebyl to strop, kterým by zadavatel
> narazil (projekt má deset úloh celkem), ale strop to byl. Nově je to velikost stránky
> a za ni se dostane tlačítkem „Načíst starší úlohy"; kurzor jde přes `updated_at`, ne
> offsetem. Zápis v `HOTOVO.md`.

- [ ] **Ukazatel průběhu importu zůstane na nule, i když import doběhl.** Naměřeno 7. 8.:
  import `040bdabb` skončil ve 14:02:24 se stavem `completed` a 25 zpracovanými řádky,
  ale obrazovka průvodce dál ukazovala „0 z 20" a větu „Import běží na serveru".
  Obrazovka se nedozvěděla, že je hotovo. Souvisí to s tím, že se na ni dá dostat i BEZ
  spuštění importu (opraveno 7. 8. skrytím obecného „Pokračovat"), ale tohle je jiná vada:
  tady import opravdu běžel a doběhl. Zjistit, jestli `StepProgress` přestal dostávat
  aktualizace, nebo jestli je dostával a nepřekreslil se

- [ ] **Z Centra úloh nevede cesta zpátky do ROZDĚLANÉHO průvodce importem.**
  Odkaz „Otevřít import" (`features/jobs/job-view.ts:101`) míří na `/contacts/import/{id}`,
  tedy na VÝSLEDEK. Import, který se nikdy nespustil a leží v `previewing`, ale žádný
  výsledek nemá; potřebuje průvodce. Ten navázat UMÍ (`?import=<id>&step=<krok>`, průvodce
  má i hlášku `wizard.resumeBanner`), jen na tu adresu nikdo neodkazuje. **Naměřeno 7. 8.
  na skutečném případu:** zadavateli zůstal rozdělaný import a v rozhraní ho neměl jak
  spustit, adresu si musel vyžádat. Je to týž tvar vady jako pětkrát dnes: schopnost
  napsaná, otestovaná, nezapojená. Rozhodnout se má i to, jestli má odkaz vést podle STAVU
  (rozdělaný do průvodce, dokončený na výsledek), nebo jestli má výsledek sám nabídnout
  pokračování

> **Osiřelá úloha se od 7. 8. HLÁSÍ, zápis v `HOTOVO.md`.** Nový hlídač
> `apps/worker/src/job-watch.ts` porovnává doménové tabulky s obsahem `pgboss.job` a měří
> STÁŘÍ, ne pouhou nepřítomnost. Chytá i stavbu publika, kterou `campaign.watchdog` schválně
> přeskakuje. Přiznané slepé místo: zabitý worker drží úlohu ve stavu `active` až do vypršení
> (u importu šest hodin) a po tu dobu hlídač mlčí.
>
> **Řádek `3e78e4df` ve vývojové databázi POŘÁD LEŽÍ** ve stavu `importing` (ověřeno
> v prohlížeči 7. 8. odpoledne). Nesahal jsem na něj: je to cizí zkušební import a zároveň
> jediný živý doklad, na kterém jde hlídač vyzkoušet. Na úklid stačí přepnout ho na `cancelled`.

Věci, na které se přišlo a nikdo je nedělá. **Tohle je seznam, který nejvíc hrozí, že zapadne.**

### Nálezy ze 7. 8. 2026 (agent `hromadne-akce`, při zapojování hromadných akcí)

- [ ] **Obrazovka Seznamy se 7. 8. odpoledne nenačte vůbec.** `/w/{slug}/contacts/lists` vrací
  místo tabulky chybový blok s kódem `validation_failed` (naměřeno 14:50, číslo požadavku
  `019fdc45-f917-7018-8a33-390163854006`). Není to vada rozhraní: odpověď API neprojde
  ověřením schématu, tedy se to láme dřív, než se stačí vykreslit jediný řádek. V pracovní
  kopii je rozepsaný `packages/core/src/contacts/api/lists.routes.ts`, takže to nejspíš drží
  agent, který na seznamech právě pracuje. **Kvůli tomu se hromadná archivace seznamů dala
  ověřit jen testy, ne v prohlížeči.**

- [ ] **Zaškrtávátka řádků se v `DataTable` nedají vypnout.** Sloupec s výběrem i hlavičkové
  „Označit všechny řádky na stránce" jsou v komponentě natvrdo a žádná propa je neruší,
  takže je má KAŽDÁ obrazovka, která tabulku použije, ať pro ni hromadná akce existuje,
  nebo ne. **Po 7. 8. zbývá jediná taková obrazovka: PŘÍJEMCI REPORTU KAMPANĚ**
  (`features/reports/adapters/report-table.tsx`, panel na `/campaigns/{id}/report`).
  Je to čtení doručení jedné kampaně, nemá jedinou řádkovou akci a API nad příjemci žádnou
  hromadnou operaci nezná, takže tam není co doplnit a výběr má zmizet. Kampaně, seznamy,
  formuláře, vlastní pole i přepisy jmen akci od 7. 8. mají.
  Rozhodnutí „doplnit akci, nebo výběr odebrat" je tím u části obrazovek předem
  omezené na první možnost. Chtělo by to `selectable={false}`; opět složka zabraná agentem
  `mobil-skorapka`.

### Nálezy ze 7. 8. 2026 (agent `zruseni-uloh`, při zapojování zastavení úloh)

> **ZAPOJENO 7. 8., zápis v `HOTOVO.md`.** Nález byl o stupeň horší: tlačítko „Pokračovat"
> na výsledku importu existovalo od začátku a NEMĚLO OBSLUHU, takže kliknutí neudělalo nic.
> Nově volá `POST /contacts/imports/{id}/resume` a bere člověka do průvodce nad novým
> importem. Věta v potvrzovacím okně zastavení, která slibovala nahrání souboru odznova,
> se srovnala se skutečností.

> **Opraveno 7. 8., zápis v `HOTOVO.md`.** `JobsLabels.progressOf` bere čísla, ne řetězce,
> a formátuje je aplikace přes `format.number`. Nový `features/jobs/job-detail.test.tsx`.

> **Odstraněno 7. 8., zápis v `HOTOVO.md`.** Týmž skenem ale vypadlo dalších sedm mrtvých
> klíčů, viz nález níž.

> **Poznámka k vývojové databázi, ať se to nehledá.** Při vizuální kontrole ve sdíleném
> prohlížeči se 7. 8. kolem 14:06 zrušil i cizí zkušební import `design-import.csv`
> (ležel ve stavu `importing` s nulou zpracovaných řádků). **Vráceno zpátky do
> `importing`** hned po zjištění; vlastní zkušební řádky agenta jsou smazané. Kdyby ta
> úloha někomu chyběla, tohle je vysvětlení.

> **`exportContactsAction` byl neaktuální nález, uzavřeno 7. 8.** Akce toho jména už
> neexistuje, opravená byla 5. 8. commitem `bab2967`. Zápis v `HOTOVO.md`.

### Nálezy ze 7. 8. 2026 (agent `potvrzeni-barva`)

> **Všechny tři uzavřeny 7. 8. agentem `navrh-soulad`, zápis v `HOTOVO.md`.**
> Archivace seznamu je doopravdy nevratná (cesta zpět není v rozhraní ani v API),
> takže věta zůstává a je nově napsaná výslovně. Tabulka 6.2 se u štítku a u člena
> srovnala na aplikaci, protože aplikace měla pravdu. Sedmnáct oken prošlo jedno
> po druhém: žádné kliknutím mimo nic neprovede a žádné neztratí rozdělanou práci.

**Zbývající drobnost z toho průchodu, patří vlastníkovi ukázkových dat:**

- [ ] **Okno „Odstranit ukázková data?" neříká, že s ukázkovou sadou zmizí i to, co
  do ní uživatel dopsal.** `purge.ts` maže přesně ty řádky, které průvodce založil,
  podle uložených identifikátorů. Kdo si ukázkový kontakt upravil nebo postavil něco
  na ukázkové šabloně, přijde o to spolu se sadou, a věta „Na nic ostatního v projektu
  se nesáhne" ho v tom utvrdí. Není to vada barvy ani úrovně (odstranění je vratné tím,
  že se sada nahraje znovu, `destructive={false}` ověřeno a zůstává), je to chybějící
  věta o následku. Klíče `onboarding.demo.dialog*` v `packages/i18n`

### Nálezy ze 7. 8. 2026 (agent `systemova-posta`)

### Nálezy ze 7. 8. 2026 (agent `filtr-kontaktu`, mimo jeho zadání)

> **Přetečení na 390 px: skořápka opravená 7. 8., zbytek přesunut do oddílu 2.5.** Nález mířil
> vedle, měření ho opravilo (hlavní sloupec měl 139 px, přetékalo skoro všechno, ne jen hledání).
> Kontakty 558 → 375 px, Nastavení 636 → 375 px. Zápis v `HOTOVO.md`.
>
> **Klikací plocha srovnaná 7. 8.**, `DESIGN-ZAKLAD.md` kapitola 1.12: jedno pravidlo,
> výjimky v tabulce i s důvodem, opravena i nepravda o WCAG (AA žádá 24 px, ne 44).
> V kódu se kvůli tomu nic měnit nemuselo. Zápis v `HOTOVO.md`.

> **Šest HTTP volání na vlastní API: rozebráno 7. 8., přesunuto do oddílu 2.6.** Není to vada,
> je to strop, takže to nepatří mezi nálezy. Doporučení a odhady jsou v 2.6.

Seřazeno podle toho, co může nejvíc bolet. Co se stihlo opravit, je v oddílu 6.

> **Hranice ověření u provozních oprav z 6. 8.** Čtyři věci jdou ověřit jen proti sestavenému
> produkčnímu obrazu nebo živé instalaci, takže jsou pokryté testy nad toutéž funkcí, ne během:
> chování cesty k migracím v zabundlovaném CLI, že `SHARP_FORCE_GLOBAL_LIBVIPS=1` opravdu přelinkuje
> knihovnu (to je vlastnost cizího balíčku), běh `genkey` a `upgrade` v kontejneru, a skutečný pád
> migrace uprostřed obnovy. **Ověřené je to, co vlastníme.** Stojí za to je projet, až se bude
> stavět obraz.

### Nálezy ze 7. 8. (okruh „poslední tři")

> **`POST /api/v1/name-overrides` umí mazat od 7. 8.** Vynechané pole znamená „nech, jak bylo",
> `null` znamená „vymaž". Fronta kontroly oslovení chráněna na volajícím. Zápis v `HOTOVO.md`.
> **Pozor: mění se kontrakt, `openapi.json` se musí přegenerovat** (je v oddílu 5).

> **Chybějící webhooky doručení, odrazu a stížnosti: rozebráno 7. 8., přesunuto do oddílu 2.7.**
> **Nález popisoval menší práci, než jaká to je.** Nechybí jen vydání tří událostí, chybí
> i jejich zdroj: příjem událostí od poskytovatele není zapojený, takže se doručení ani odraz
> dnes nikam nezaznamenají. Rozbor a odhady v 2.7.

### Nálezy ze 7. 8. 2026 (agent `provoz-nalezy`, mimo jeho zadání)

- [ ] **`cursor_contact_id` v `campaign_audience_progress` nemá cizí klíč a nikdo ho
  neodpojuje.** Sloupec drží ID kontaktu, u kterého stavba publika naposledy skončila,
  a na rozdíl od ostatních odkazů v té tabulce k němu **není `REFERENCES contacts`**
  (ověřeno v `packages/db/migrations/0001_core_tables.sql`, řádky 881 až 894 a 1299 až
  1300). Po výmazu kontaktu podle článku 17 v něm tedy zůstane ležet ID vymazaného
  člověka, dokud kampaň sama nezmizí. Je to JEN identifikátor, ne osobní údaj, a
  `gdpr.sever_links` chodí po vyjmenovaných tabulkách, takže tuhle o něm neví. Rozhodnout,
  jestli to má být další odpojovaný odkaz, nebo jestli se má sloupec po `phase = 'done'`
  nulovat. Nesahal jsem na to, je to cizí teritorium (`contacts`)
- [ ] **Nedělní ověření zálohy se v sestaveném obrazu neověřilo.** Nález z 6. 8. o chybějící
  cestě k migracím je v kódu opravený (`resolveMigrationsFolder()` je povinná a společná
  pro obě cesty) a dokumentace to už netvrdí, ale že se cesta v produkčním obrazu opravdu
  odvodí správně, jde vyzkoušet jedině proti němu. Patří k výčtu „ověřitelné až proti
  obrazu" výš. **Nově to aspoň nezůstane tiché:** doktor od 7. 8. hlásí
  `backup_verify_failed`, respektive `no_backup_verify_yet`

### Nálezy ze 7. 8. (okruh „Centrum úloh")

> **Srovnáno 7. 8., zápis v `HOTOVO.md`.** Nejsou to dva výčty, jsou to DVA POJMY:
> `UNFINISHED` (běží i pozastavené) dělí seznam, `RUNNING` (jen běžící) rozsvěcí odznak.
> Obojí pod týmiž jmény v jádře i v návrhovém systému, filtr API si výčet čte z registru.
> Nadpis sekce se změnil z „Běží" na „Rozdělané". Cestou vyšlo najevo, že totéž dělal
> i stav `pending`, tedy nahraný soubor s nedokončeným průvodcem; nově je taky `paused`.
### Nálezy ze 7. 8. (agent `katalog-udalosti`)

> **Katalog typů odchozích událostí je hotový, zápis v `HOTOVO.md`.** Tady zůstávají jen
> tři věci, které z něj vypadly a nikomu nepatří.

> **Rozhodnuto a hotovo 7. 8. NARÁZ s cíleným doručením, zápis v `HOTOVO.md`.**
> `ping` se přejmenoval na `webhook.ping` a z nabídky odběru zmizel: cílené doručení dělá
> odběr bezvýznamným. Vznikla třetí kategorie katalogu `TARGETED_WEBHOOK_EVENT_TYPES`
> (vydává se, neodebírá se), starý tvar `ping` zůstává mezi vysloužilými.
> **Hotovo 7. 8., zápis v `HOTOVO.md`, a nález byl VĚTŠÍ, než jak se popisoval.**
> Cesta `/test` událost jen zapsala a `platform.webhook_fanout` NIKDY NEZAŘADILA, takže
> doručení nevzniklo ani jedno, ať endpoint odebíral co chtěl; zaškrtnutí `ping` to tedy
> nespravilo. Nově cílené doručení mimo fan-out, se stejným podpisem, opakováním i logem
> (sdílené `enqueueDelivery` v `emit.ts`).
### Nálezy ze 7. 8. (agent `ulohy-zbytky`, mimo jeho zadání)

- [ ] **Sedm dalších mrtvých klíčů v `common.jobs.*`.** Týž sken, jakým se ověřil
  `common.jobs.cancel`, vypsal ještě `history`, `showAll`, `pause`, `resume`, `download`,
  `otherProjects` a `remaining`. Všechny jsou ze stejné várky popisků návrhového systému
  a v kódu je nepoužívá nic (`history` obzvlášť matoucí: obrazovka bere `historyLimit`).
  Odstranil jsem jen ten jeden, který byl v zadání; u zbylých je možné, že se s nimi počítá
  (`remaining`, „Zbývá {duration}", by se na detailu úlohy hodil), takže to má rozhodnout
  vlastník, ne úklid mimochodem.

- [ ] **`platform/jobs/jobs.test.ts` je ČERVENÝ a není to mou prací.** Dva testy hlásí
  `platform.maintain_partitions`: komentář v testu i v jeho výčtu výslovně říká, že ta fronta
  „z registru i z tohohle seznamu ODEŠLA", ale v `queues/registry.ts` pořád je. Buď se
  odstranění nedodělalo, nebo ji někdo vrátil. Sahá to do registru front, tedy cizí teritorium.

- [ ] **Stav importu se překládá na „běží" na DVOU místech a od 7. 8. si odporují.**
  `platform/jobs/built-in-sources.ts` hlásí `pending` i `previewing` jako `paused`, protože
  se v obou fázích čeká na člověka. `apps/web/src/features/import/result-status.ts` má vlastní
  výčet, kde jsou obě `running`, takže obrazovka výsledku importu ukáže u opuštěného průvodce
  nadpis „Import ještě běží" a ukazatel průběhu, který se nikdy nepohne. Je to tentýž nález
  jako u odznaku, jen o obrazovku vedle. Nesahal jsem na to: `features/import` je cizí
  teritorium a změna mění chování průvodce, ne jen popisek.

### Nálezy ze 7. 8. (agent `zlata-cesta`, při rozšiřování testu zlaté cesty)

Všechny naměřené proti ČERSTVĚ SESTAVENÉMU obrazu (`ghcr.io/nc-mill/mlain:1.0.0`
přestavěnému 7. 8. z aktuální pracovní kopie) a proti čisté instalaci z compose.

- [ ] **NOVÝ NÁLEZ 7. 8. (agent `odesilani-nefunguje`): účet SMTP BEZ ŠIFROVÁNÍ nemůže
  odeslat nic a produkt ho přesto nabízí.** Vyplavalo to při dokazování nálezu výš, hned
  za opravenou vadou čtení účtu. Dialog „Nový odesílací účet" nabízí šifrování „Žádné"
  a uživatelské jméno s heslem VYŽADUJE (`min(1)`), jenže sender v Go odmítá poslat heslo
  po nešifrovaném spojení a zprávu ukončí kódem `smtp_insecure_auth_refused`
  (`apps/sender/internal/provider/smtp/client.go:172`, třída fatal). **Naměřeno na čisté
  instalaci:** `messages.error_code = smtp_insecure_auth_refused`,
  `detail = "smtp_insecure_auth_refused: 0"`, zpráva zůstala `pending`.
  **Únik z toho v produktu NENÍ.** Go konfigurace zná `allow_insecure_auth`
  i `insecure_skip_verify` (`apps/sender/internal/credentials/providerconfig.go:42`), ale
  schéma v TypeScriptu je `.strict()` a ani jedno pole neobsahuje, takže je aplikace nemá
  jak zapsat. Jsou to dvě mrtvá pole.
  **Týká se to zlaté cesty:** fixture `SMTP` v `apps/web/e2e/golden/fixtures/test-data.ts`
  volí „Žádné", takže kampaň touhle cestou odejít nemůže. Důkaz odeslání musel poštovní
  past postavit na STARTTLS s vlastním certifikátem, aby vůbec šlo doložit, že zpráva odejde.
  Rozhodnout se musí byznysově, protože jde o poslání hesla v otevřené podobě:
  buď zaškrtávátko „server nemá šifrování, heslo pošli přesto" s jasnou větou o následku
  (a doplnit obě pole do šifrované obálky), nebo dialog přestane „Žádné" nabízet spolu
  s heslem. Do rozhodnutí platí, že self-hosting proti lokálnímu Postfixu bez TLS
  neodešle nic a uživatel se dozví jen kód

- [ ] **Časová past veřejného formuláře zahodí přihlášení TIŠE a stránka přesto poděkuje.**
  `checkProtection` (`packages/core/src/contacts/forms/protection.ts:83`) zahodí odeslání
  rychlejší než `min_fill_seconds`, jehož výchozí hodnota je **2** (`forms/definition.ts:79`).
  Zahození je záměrně tiché, aby se bot nedozvěděl, které pravidlo ho chytlo, takže
  návštěvník uvidí „Poslali jsme vám e-mail s odkazem" a **žádný e-mail nedostane**.
  **Naměřeno na běžící instalaci:** `form_submissions` má řádek se `status = 'dropped'`,
  `error_code = 'too_fast'`, `contact_id` prázdné; v `contacts` nula řádků, v pasti nula zpráv.
  U bota je to správně. U ČLOVĚKA to správně není a stát se to může snadno: správce hesel
  nebo automatické doplňování vyplní pole naráz a člověk stiskne odeslat dřív než za dvě
  sekundy. Přijde tak o přihlášení, o kterém se nikdo nedozví, protože i produkt si myslí,
  že bylo v pořádku. Rozhodnout, co je správně: buď hranici snížit a měřit i jiný signál
  (pohyb, stisky kláves), nebo aspoň dropnutá odeslání zviditelnit tam, kde je uvidí
  správce formuláře. Dnes se nepočítají ani mezi „přihlášení celkem"

- [ ] **Obraz, proti kterému jede zlatá cesta, nikdo nepřestavuje.**
  `docker/compose.yml` používá pevný `ghcr.io/nc-mill/mlain:1.0.0` a ani global setup,
  ani `installation.ts` obraz nesestavují: dělají jen `down --volumes` a `up -d`. Na
  vývojářském stroji byl 7. 8. odpoledne v mezipaměti obraz ze **3. 8.**, tedy o čtyři dny
  a několik desítek oprav starší než pracovní kopie. Kdo dnes zlatou cestu pustil, měřil
  starý kód a nálezy z toho běhu neplatí. Chce to buď krok „přestav obraz" v global setupu,
  nebo aspoň hlasitou kontrolu, že obraz není starší než poslední commit

- [ ] **Zlatá cesta nemohla nikdy doběhnout do konce a nikomu to nedošlo.**
  Krok 8 čekal na doručenou kampaň pro `overena@firma.cz`, jenže ta adresa **není mezi
  padesáti importovanými kontakty** a ve zkušebním režimu se doručuje výhradně na ověřené
  adresy (`canSendInTrial`). Publikum kampaně tedy neobsahovalo nikoho, komu se smí poslat,
  a čekání muselo skončit vypršením limitu. Sada se přitom tváří jako existující pojistka.
  **Opraveno v testu** (ověřená adresa se nově přihlásí veřejným formulářem), ale nález
  patří sem, protože ukazuje širší věc: **na zelenou zlatou cestu se nedá spoléhat, dokud
  ji někdo opravdu nepustí.** Objekt obrazovky reportu byl navíc napsaný podle plánu,
  ne podle produktu: hledal `tile-clicked`, `tile-unsubscribed`, `open-rate-caveat`
  a `metric-percentage-*`, a **ani jeden z těch čtyř háčků v repozitáři není**

---

## 5. Před commitem

Nadpis tohohle oddílu 7. 8. z dokumentu zmizel při souběžné úpravě jiného agenta
a jeho položky zůstaly viset pod oddílem 4. Vrácen zpátky.

- [ ] **Přegenerovat `packages/contracts/openapi.json` také kvůli webhookům (7. 8.).**
  `CreateWebhookEndpointInput` a `UpdateWebhookEndpointInput` mají u `event_types` nový
  popis se seznamem platných typů. Typ zůstává `string`, ne `enum`, schválně: enum by zod
  odmítl dřív, než se požadavek dostane do domény, a klient by místo hlášky se seznamem
  a návrhem opravy překlepu dostal obecné „invalid enum value". Důvod je zapsaný v kódu
  u `EVENT_TYPES_DESCRIPTION`.
  **Přibyl druhý důvod (7. 8., agent `ulohy-zbytky`):** cesta
  `POST /webhook-endpoints/{id}/test` má nové `summary` i `description`, protože se testovací
  událost od dneška doručuje cíleně mimo fan-out, a `EVENT_TYPES_DESCRIPTION` se zkrátil
  o `ping`, který se přejmenoval na `webhook.ping` a z nabídky odběru zmizel
- [ ] Přegenerovat `packages/contracts/openapi.json`, až bude strom klidný. Dnes ho měnili
  nejmíň tři agenti, takže se to musí udělat AŽ NAKONEC a jednou. Kontroluje to
  `apps/web/test/api/openapi.test.ts` druhým testem („vygenerovaný dokument se shoduje
  s commitnutým souborem"), který je do té doby červený a je to očekávané
- [x] **Počet operací části 1 srovnán 7. 8. ze 46 na 47** i s důvodem v komentáři: přibyla
  `POST /api/v1/invitations/signup`. Bez toho by číslo za měsíc nikdo nedokázal zdůvodnit
- [ ] Ověřit, že `pnpm test:unit`, `pnpm typecheck` a `pnpm lint` jsou zelené.
  **Spouštět až po zastavení všech agentů**, jinak to padá na cizí rozdělané práci
  a čte se to jako regrese. Stroj má 8 GB RAM a dnes dvakrát zamrzl, takže ne paralelně
- [ ] Zkontrolovat, že v pracovním stromu nejsou zkušební data ani snímky, které tam nepatří.
  Dnešní konkrétní kandidáti: soubory `*.bak` (jeden se objevil a zmizel), pomocné postroje
  v kořenech balíčků a dočasné skripty pro migrace
- [ ] Uklidit kontejnery po dnešních agentech: `mlain-bundled-check` a `mlain-extdoc-pg`
  (Postgres, po 40 MB). Potřebné zůstávají `mlain-dev-pg`, `mlain-test-pg` a `mlain-syscheck-mailpit`
- [ ] Vývojová databáze `mlain_clean` má vlastní pole `boolen` založené 4. 8. při testování.
  Zadavatel o něm neví a nechce ho. Po dokončení obrazovky vlastních polí ho jde smazat z rozhraní

---

## 6. Hotové

Přesunuto **7. 8. 2026** do samostatného souboru, aby tenhle dokument držel jen
to, co je potřeba udělat, zadat nebo rozhodnout.

**Archiv: `docs/superpowers/HOTOVO.md`**

Pravidlo zůstává: hotové se neškrtá pryč, přesouvá se tam s datem a se způsobem
ověření. Historie je součástí ceny.
