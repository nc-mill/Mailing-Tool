# Systémová pošta i přes SES

Datum: 2026-08-05. Krátký plán, ne specifikace.

---

## Stav k 6. 8. 2026 (revize proti kódu): PLÁN PLATÍ CELÝ, NEZAČALO SE

Ověřeno: `SYSTEM_MAIL_CAPABLE_TYPES` je pořád `['smtp']`
(`packages/core/src/platform/system-mail-config.ts:33`), soubor
`platform/system-mail-ses.ts` neexistuje, `DefaultSystemMailer.send` větev pro
SES nemá. Body 1 až 10 z kapitoly 3 jsou všechny otevřené.

Tři věci z okolí, které plán zpřesňují:

- **Klient SES v TypeScriptu je opravdu k dispozici** (kapitola 1). Od té doby
  přibyl další doklad: transakční pošta a e-maily seznamu jedou outboxem, ale
  `packages/core/src/providers/ses/client.ts` a závislost `@aws-sdk/client-sesv2`
  jsou na místě, takže krok 1 zůstává jedním voláním `SendEmailCommand`.
- **RZ4 (souběh s prací na e-mailech seznamu) je vyřízené.** Ta práce je hotová
  a registruje se v `apps/web/src/instrumentation.ts` vedle `installSystemMailer()`
  jako `installSubscriptionEmails()`. Kolize v místě registrace při startu tedy
  zbývá jen jako jeden řádek navíc, ne jako riziko.
- Poslední migrace v repozitáři je **0021**. Tenhle plán žádnou migraci nepotřebuje,
  takže se ho číslování netýká.

---

Cílem plánu je, aby pozvánka, obnova hesla
a ostatní systémové zprávy odešly i na instalaci, která má jen účet typu SES, a aby se
uživatel vždycky dozvěděl pravdu o tom, jestli zpráva odešla.

## 1. Co dnes nefunguje a proč

`SYSTEM_MAIL_CAPABLE_TYPES = ['smtp']`
(`packages/core/src/platform/system-mail-config.ts:33`). Systémovou poštu odešle jedině
účet typu SMTP. Instalace po průvodci má typicky jen SES, takže neodejde nic:

| Zpráva | Odesílatel | Co se stane dnes |
|---|---|---|
| `invitation` | `identity/invitation-service.ts:146` | pozvánka se ani nezaloží, `system_mail_unavailable` |
| `password_reset` | `identity/password-reset.ts:93` | chyba 503, člověk se do instalace nedostane |
| `password_changed` | `identity/password-reset.ts:172`, `identity/change-password.ts:75` | tiše se zaloguje a jde se dál |
| `trial_address_verification` | `providers/api/trial-service.ts:190` | chyba 503 |
| `webhook_endpoint_disabled` | `platform/webhooks/disable.ts:136` | tiše se zaloguje |

Ověřeno na této instalaci (`mlain_clean`): tři projekty, jediný odesílací účet
`MlainMailer` typu `ses` v projektu „Petr Osobní mail", ostatní dva projekty nemají
žádný. Systémová pošta tedy dnes neodejde ze žádného ze tří projektů.

**Tichá lež už z velké části opravená není.** `queueSystemMail`
(`platform/system-mail.ts:173`) selhání loguje a u zpráv v `MUST_NOT_FAIL_SILENTLY` hází
`system_mail_unavailable`; zakládání pozvánky má předběžnou kontrolu
(`invitation-service.ts:86`) a doctor má nález `system_mail_unavailable`
(`ops/doctor/checks-workspace.ts:119`). Zbývající tichá cesta jsou dvě informační zprávy
(`password_changed`, `webhook_endpoint_disabled`), a ty tiché být mají.

**Skutečný zbývající problém je tedy jen jeden: chybí odeslání přes SES.**

### Zásadní nález: klient SES v TypeScriptu UŽ MÁME

Komentáře v `system-mail-config.ts:27` a v doctoru tvrdí, že „klient SES je jen v Go".
To dnes neplatí:

- `packages/core/package.json:55` má závislost `@aws-sdk/client-sesv2` (3.1100.0),
- `packages/core/src/providers/ses/client.ts` už staví `SESv2Client` přímo z `SesConfig`
  (`createAwsClients`), používá se na ověřování domén, konfigurační sady a SNS,
- Go dispatcher (`apps/sender/internal/provider/ses/ses.go:98`) posílá `SendEmail`
  s `Content.Raw`, tedy hotové MIME. Totéž MIME už umí `buildSystemMailMime`
  (`platform/system-mail-templates.ts:145`).

Chybí doslova jedno volání `SendEmailCommand`. Tvrzení „podpis AWS na dvou místech" bylo
pravdivé v době, kdy se to psalo, ale závislost mezitím do `packages/core` přibyla kvůli
setupu, takže dnes nic nového nepřidáváme.

## 2. Rozhodnutí

### R1. Systémová pošta zůstává na vlastní přímé cestě, jen dostane větev pro SES

Do `DefaultSystemMailer.send` (`platform/system-mailer.ts:154`) přibude druhá větev:
`config.kind === 'ses'` → `SendEmailCommand` s `Content: { Raw: { Data: mime } }`.
`SYSTEM_MAIL_CAPABLE_TYPES` se rozšíří na `['smtp', 'ses']` a přestává být omezením
produktu; zůstává jako jediné místo pravdy pro obrazovku i odesílatele.

**Zamítnuto: poslat systémovou poštu outboxem.** Je to nejbližší hotový vzor
(`transactional/send.ts`), ale pro tenhle případ se nehodí ze čtyř důvodů:

1. **`messages.contact_id` je `NOT NULL`** (`packages/db/src/schema/partitioned.ts:129`,
   migrace `0003_partitioned_tables.sql:98`). Uvolnění znamená migraci partitionované
   tabulky a revizi všeho, co s `contact_id` počítá: časová osa kontaktu, reporty,
   rekonciliace, výmaz podle GDPR (`CHECK (contact_id IS NOT NULL OR erased_at IS NOT NULL)`
   u navazujících tabulek). Transakční cesta si právě proto kontakt zakládá
   (`transactional/send.ts:319`).
2. **Příjemce není kontakt.** Zakládat kolegovi kontakt kvůli pozvánce znečistí databázi
   kontaktů, segmenty a statistiky. Toto je věcný, ne technický důvod, a sám o sobě stačí.
3. **Ztratila by se synchronnost tam, kde je potřeba.** Dnes se člověk hned dozví, že
   pozvánka neodešla. Přes outbox by výsledek závisel na běžícím Go senderu: instalace se
   zastaveným senderem by hlásila „odesláno" a obnova hesla by nikdy nedorazila. To je
   přesně ta tichá lež, kterou tenhle úkol odstraňuje.
4. **Nemá to nosič obsahu.** Outbox čte předmět a HTML z hlavičky kampaně a odesílatele
   z `sender_identities`. Systémová pošta má vlastní adresu (`mlain@doména`) a vlastní
   nastavení, které uživatel v UI už vidí a mění.

Co se tím ztrácí a přijímá se to vědomě: systémová pošta obchází kvóty a omezení rychlosti
senderu a neobjeví se v reportech. Objem jsou jednotky zpráv denně, takže riziko throttlingu
je zanedbatelné. Viz riziko RZ1.

### R2. Když příjemce nepatří do žádného projektu, rozhoduje „projekt systémové pošty instalace"

Dnes `resolveWorkspaceId` (`system-mailer.ts:84`) vezme nejstarší projekt uživatele přes
`withUser`, a když žádný nemá, hodí chybu. To je špatně u obnovy hesla uživatele, který byl
odebrán z posledního projektu (stránka `no-workspace` takový stav zná).

Řešení: singleton `system_settings` (ověřeno v DB: existuje, je bez RLS, má `settings jsonb`)
dostane klíč `systemMail.workspace_id`. Pořadí výběru:

1. `mail.workspaceId`, pokud zpráva projekt nese,
2. nejstarší projekt uživatele (dnešní chování, beze změny),
3. **nově:** projekt z `system_settings.settings.systemMail.workspace_id`,
4. **nově:** když není nastavený, nejstarší nesmazaný projekt instalace, který má použitelný
   odesílací účet.

Je to self-hosted instalace jednoho vlastníka, ne SaaS s cizími nájemníky, takže
„půjčit si" odesílací účet jiného projektu není únik ani porušení izolace. Krok 4 se čte
přes `withoutContext`, protože se ptáme na instalaci, ne na projekt.

**Úplně první instalace:** průvodce (`identity/setup.ts:122`) zakládá prvního uživatele
a první projekt v jedné transakci, takže stav „uživatel bez jediného projektu v instalaci"
při instalaci nevzniká. Zbývá stav „projekty jsou, ale žádný nemá odesílací účet"; ten řeší
R3.

**Zamítnuto: vlastní odesílací účet instalace** (SMTP z proměnných prostředí nebo vlastní
řádek v `sending_providers` bez projektu). Je to čistší model, ale znamená nové nastavení,
novou obrazovku a další věc, kterou musí vlastník nastavit, aby mu chodily pozvánky.
Nechat to na existující účty je levnější a nikoho to nezdrží. Dá se doplnit později, klíč
v `system_settings` se pak jen přesměruje.

### R3. Když odesílání není nastavené vůbec, řekne se to na místě, kde to vzniká

Vzor už existuje u pozvánky a rozšíří se:

- **Pozvánka:** beze změny, kontrola před zápisem (`invitation-service.ts:86`) je správně.
  Jen se opraví text nálezu, protože po R1 už „přidejte účet typu SMTP" nebude pravda.
- **Nastavení → Tým:** formulář pozvánky se zobrazí zašedlý s vysvětlením a odkazem do
  Nastavení → Odesílání, místo aby chybu ukázal až po odeslání.
- **Obnova hesla:** formulář nesmí prozrazovat, jestli adresa v instalaci existuje, takže
  neutrální hláška zůstává. Ale zjištění „instalace nemá ani jeden odesílací účet" na
  existenci uživatele nezávisí, takže se v tom případě vrátí `system_mail_unavailable`
  s návodem použít `mlain reset-password <e-mail>`. Únik informace to není.
- **Doctor** (`checks-workspace.ts:119`): nález zůstává, mění se text a podmínka. Po R1
  je závadný stav už jen „žádný použitelný účet" a „vybraný účet zmizel".

### R4. Systémové šablony zůstávají pevné v kódu

`platform/system-mail-templates.ts` má pět zpráv o třech větách v `cs` a `en`, prostý text
plus minimální HTML, bez obrázků a sledování. Do knihovny šablon se **nepřesouvají**,
na rozdíl od e-mailů seznamu:

- Šablony jsou vlastnictvím projektu, ale systémová pošta míří na uživatele nástroje a musí
  fungovat i pro příjemce mimo projekt (R2).
- Zpráva o obnově hesla musí odejít i tehdy, když je šablona smazaná, prázdná nebo se
  nezkompiluje. U e-mailu seznamu je pád zpět na výchozí znění přijatelný, tady by šablona
  navíc přidala nový důvod, proč se do instalace nedostanu.
- Blokový editor produkuje HTML závislé na značce projektu a na `ASSET_BASE_URL`. Systémová
  zpráva má být co nejjednodušší, aby prošla i přes agresivní filtry.

Doladění (ne podmínka funkčnosti): do textů se doplní jméno projektu a jméno instalace,
aby pozvánka neříkala jen „byli jste pozváni ke spolupráci na projektu". To je pár řádků
v témž souboru, ne nová vrstva.

### R5. Pravidla převzatá od transakční pošty se drží samy, jen se pojistí testem

- **Bez odhlašovacího odkazu a bez `List-Unsubscribe`:** `buildSystemMailMime`
  (`system-mail-templates.ts:145`) skládá hlavičky ručně a žádnou takovou nepřidává. Navíc
  má `Auto-Submitted: auto-generated` a `X-Auto-Response-Suppress: All`.
- **Bez měření:** `renderSystemMail` staví HTML z prostého textu, žádný sledovací pixel ani
  přesměrovaný odkaz tam nevzniká.
- **Marketingové odhlášení příjemce nesmí zprávu zastavit:** systémová cesta `suppressions`
  vůbec nečte a číst je nebude. U SES se přidá `ConfigurationSetName`, jen když ho účet má;
  účtový suppression list AWS si hlídá samo a to je správně (tvrdý odraz).
- **U SES se schválně nenastavuje `ListManagementOptions`**, stejně jako v Go
  (`ses.go:110`), aby SES nepřepsal naše hlavičky svými.

Pojistka: test, který zkontroluje, že složené MIME neobsahuje `List-Unsubscribe` a že
v HTML není `/o/` ani `/c/` (sledovací cesty).

### R6. Fronta se nezavádí, odesílání zůstává synchronní

Rozdělení už v kódu je (`MUST_NOT_FAIL_SILENTLY`, `system-mail.ts:137`) a odpovídá tomu,
co uživatel potřebuje:

- **Pozvánka, obnova hesla, ověření adresy:** uživatel na výsledek čeká a musí se hned
  dozvědět, že to nevyšlo. Fronta by tady škodila: „zařadili jsme to" není odpověď na
  „nedostal jsem e-mail". Zůstává synchronní.
- **Změna hesla, vypnutý webhook:** informace o něčem, co se už stalo. Fronta by pomohla,
  ale kvůli dvěma zprávám se nový mechanismus nezavádí.

Doladění (ne podmínka funkčnosti): pro ty dvě informační zprávy se dá použít **existující**
fronta jobů (`platform/jobs/queue-handlers.ts:40`, vzor `platform.webhook_deliver`) a přidat
job `platform.system_mail_send` s pár pokusy. Až po tom, co odesílání přes SES funguje.

## 3. Pořadí prací

### Bez toho to nefunguje

1. **Odeslání přes SES z TypeScriptu.** Nový `packages/core/src/platform/system-mail-ses.ts`:
   z `SesConfig` postaví `SESv2Client` (znovupoužít `createAwsClients`, nebo úzký vlastní
   konstruktor bez SNS), pošle `SendEmailCommand` s `Content.Raw`, `ConfigurationSetName`
   jen když je vyplněný, retry SDK na 1 pokus jako v Go. Chyby se převedou na
   `SystemMailSendError` s kódem z AWS.
2. **Větev v `DefaultSystemMailer.send`** podle `config.kind` a rozšíření
   `SYSTEM_MAIL_CAPABLE_TYPES` na `['smtp', 'ses']`. Zároveň se opraví
   `SYSTEM_MAIL_ACCOUNT_ORDER`: přednost SMTP před výchozím účtem přestává dávat smysl,
   nově rozhoduje `is_default`, pak stáří.
3. **Pád zpět na projekt instalace** (R2) v `resolveWorkspaceId` plus čtení a zápis klíče
   `systemMail.workspace_id` v `system_settings`.
4. **Texty a nálezy** (R3): doctor, katalog chyb `system_mail_unavailable`
   (`errors/detail-catalog.ts:53` a `:223`), obrazovka Nastavení → Systémová pošta. Nikde
   už nesmí stát „přidejte účet typu SMTP".
5. **Testy:** jednotkový test SES větve s falešným klientem, test výběru účtu při samotném
   SES, test pádu zpět na projekt instalace, test hlaviček z R5. Aktualizovat testy, které
   dnes na jednoprvkovém seznamu stojí (`system-mail.test.ts`,
   `system-mail-delivery.db.test.ts`, `test/ops/doctor-runtime.db.test.ts:103`,
   `identity/membership-service.test.ts:48`).

### Doladění

6. Zašedlý formulář pozvánky v Nastavení → Tým s vysvětlením (R3).
7. Neutrální, ale pravdivá odpověď formuláře obnovy hesla při instalaci bez účtu (R3).
8. Jméno projektu a instalace v textech systémových zpráv (R4).
9. Job `platform.system_mail_send` pro dvě informační zprávy (R6).
10. Volba „projekt systémové pošty instalace" na obrazovce Nastavení → Systémová pošta;
    do té doby se počítá automaticky podle R2, kroku 4.

## 4. Odhad

Body 1 až 5 jsou zhruba **den práce**: dva menší nové soubory, změny v pěti existujících,
úpravy asi šesti testovacích souborů. Žádná migrace databáze, žádný zásah do Go senderu,
žádná nová závislost. Body 6 až 10 dohromady zhruba **další den**, dají se dělat po částech.

## 5. Rizika

- **RZ1. Obcházení kvót SES.** Systémová pošta nejde přes outbox, takže se nepočítá do
  omezení rychlosti. Při rozesílce na hranici kvóty může SES vrátit throttling a pozvánka
  neodejde. Dopad je malý (jednotky zpráv denně) a projeví se hlasitě, ne tiše. Zmírnění:
  chybu `Throttling` klasifikovat zvlášť a v hlášce poradit opakování.
- **RZ2. Neověřená adresa odesílatele.** SES odmítne `From`, které není ověřenou identitou.
  `resolveSystemMailFrom` (`system-mail-config.ts:174`) padá zpět na host z `APP_URL`, což
  u SES skončí chybou `MessageRejected`. Zmírnění: když je účet typu SES a adresa vznikla ze
  zdroje `app_url`, hlásit to na obrazovce jako závadu ještě před odesláním.
- **RZ3. Události o systémové poště nemají kam padnout.** Odraz nebo stížnost u zprávy bez
  řádku v `messages` přijde přes SNS a nespáruje se. Zmírnění: neposílat message tagy
  `ml_msg` a `ml_mday` a ověřit, že příjem událostí nespárovanou událost jen zahodí a nespadne.
- **RZ4. Souběh s prací na e-mailech seznamu.** Ta práce sahá na outbox a na
  `installSystemMailer` v `instrumentation.ts`; tenhle plán na outbox nesahá vůbec, kolize
  je jen v místě registrace při startu.

## 6. Otázky pro zadavatele

1. **Smí si systémová pošta „půjčit" odesílací účet jiného projektu** (R2, krok 4), když
   příjemce do žádného projektu nepatří? *Doporučuji ano.* Je to instalace jednoho vlastníka
   a alternativou je, že se odebraný uživatel nedostane k obnově hesla.
2. **Má se `mlain@doména` u SES tvrdě vyžadovat z ověřené domény?** *Doporučuji ano:*
   nedovolit odeslání s adresou odvozenou z `APP_URL`, protože ji SES stejně odmítne, a říct
   to uživateli dopředu (RZ2) místo chyby při odesílání.
3. **Má se systémová pošta objevit v reportech nebo v protokolu odeslaného?** *Doporučuji ne*
   v reportech (nepatří ke kampaním) a *ano* v protokolu auditu, kde už dnes záznam o pozvánce
   a obnově hesla je.
4. **Fronta pro dvě informační zprávy** (R6, bod 9), teď nebo později? *Doporučuji později*,
   nemá vliv na to, co uživatel dnes nedostane.
