# E-maily seznamu: potvrzení, uvítání, rozloučení

Datum: 2026-08-05. Krátký plán, ne specifikace. Cílem je, aby potvrzovací e-mail
skutečně odešel a aby si šlo na úrovni seznamu nastavit, jak vypadá.

## 1. Co se dnes stane, když přidám kontakt ručně

Krok za krokem, ověřeno v kódu:

1. Formulář `/w/{slug}/contacts/new` (`apps/web/src/features/contacts/contact-form.tsx`)
   nabídne přepínač „přihlášení": `confirmed` (výchozí) nebo `pending`, a k tomu
   zaškrtávátka seznamů. **Opt-in seznamu se nikde nezobrazuje.**
2. `createContactAction` (`apps/web/src/features/contacts/edit-actions.ts:258`) pošle
   `POST /api/v1/contacts` s `lists: [{ list_id, status }]`.
3. `upsertContactFromApi` (`packages/core/src/contacts/repo/contacts-api.ts:142`) zapíše
   přihlášení **napřímo** přes `writeSubscriptionIn`. Nevolá `subscribeToList`, nevolá
   stavový automat, **sloupec `lists.opt_in` vůbec nečte**.
4. Vznikne přesně ten stav, který zvolil správce. Na seznamu s dvojím potvrzením tedy
   vznikne `confirmed` bez jediného potvrzení příjemcem.
5. **Žádný token se nevydá** (`issueConfirmation` se nezavolá) a **žádný e-mail neodejde.**

To znamená, že v tomhle konkrétním případě nešlo o tiché selhání odesílání, ale o to, že
ruční přidání potvrzovací kolo záměrně obchází. Text u formuláře to i přiznává:
„Potvrzovací e-mail mu neposíláme" (`packages/i18n/messages/cs/contacts.json:955`).

Ruční poslání jde z detailu kontaktu, tlačítko u každého `pending` seznamu
(`contact-detail.tsx:366` → `POST /api/v1/lists/{id}/resend-confirmation`). **A tady už
selhání tiché je**: dojde se až k `sendConfirmationEmail`, ale port není nikdo
zaregistrovaný, takže `emails?.sendConfirmation(...)` je no-op a uživatel dostane úspěch.
Stejné tiché mlčení má formulář na webu, potvrzovací stránka i centrum předvoleb.

Shrnuto: dvě různé vady. Ruční přidání e-mail vůbec neplánuje, všechny ostatní cesty ho
plánují a nepošlou.

## 2. Jak zapojit odesílání

**Klíčové zjištění: e-maily seznamu nesmí jít přes systémovou poštu.**
`queueSystemMail` umí jen SMTP (`SYSTEM_MAIL_CAPABLE_TYPES = ['smtp']`,
`packages/core/src/platform/system-mail-config.ts:33`), protože TS klient pro SES neexistuje.

Vedle toho už ale máme funkční cestu, která SES umí, protože odesílá Go sender: **outbox**.
Chodí po ní tři věci a všechny jsou blízkým příbuzným našeho případu:

| Cesta | Soubor | `messages.kind` |
|---|---|---|
| Transakční API | `packages/core/src/transactional/send.ts` | `transactional` |
| Testovací odeslání šablony | `packages/core/src/templates/test-send.ts` | `test` |
| E-mail z formuláře (e-book) | `packages/core/src/contacts/forms/delivery-email.ts` | `test` |

### Návrh

Nový soubor `packages/core/src/contacts/lists/subscription-emails.ts`, implementace
`SubscriptionEmailPort`, postavená podle `forms/delivery-email.ts` skoro jedna ku jedné:

1. Dohledat seznam a jeho šablonu (nebo vzít vestavěné výchozí znění, viz kapitola 3).
2. `compileTemplate({ purpose: 'test', trackOpens: false, trackClicks: false })`.
3. `upsertSystemCampaign` (skrytá kampaň `kind = 'system'`, jedna na seznam a druh e-mailu).
4. `INSERT INTO messages` s `kind = 'transactional'`, `status = 'pending'`.
5. Vrátit důvod, ne boolean, přesně jako `DeliveryOutcome`. Nedoručený e-mail nesmí
   shodit přihlášení, které je už zapsané.

**Potvrzovací odkaz nepotřebuje změnu v Go.** Sender pouze dekóduje `messages.render_data`
(`apps/sender/internal/app/worker.go:168`), a kořen `data` je v Liquidu povolený pro
`kind = 'transactional'` (`packages/contracts/src/liquid/grammar.ts:45`). Do `render_data`
tedy zapíšeme `data.confirm_url = {APP_URL}/s/c/{token}` a v šabloně se použije
`{{ data.confirm_url }}`. Žádný nový kořen, žádný zásah do senderu.

**Proč `kind = 'transactional'` a ne `test`.** Sender u transakční zprávy sám vypne měření
a nepřidá hlavičku `List-Unsubscribe` (`worker.go:90`, `outbox/store.go:62`), což je pro
potvrzovací e-mail přesně žádoucí. `{{ unsubscribe_url }}` v těle přesto funguje, kdyby ho
autor u uvítacího e-mailu chtěl.

### Registrace portu

`registerSubscriptionEmails(port)` zavolat tam, kde se dnes volá `installSystemMailer()`:
`apps/web/src/instrumentation.ts:33` a `apps/worker/src/main.ts:71`. Zároveň zapojit
`areSubscriptionEmailsAvailable()` do diagnostiky, ať tiché mlčení příště vidíme.

### Ruční přidání kontaktu

`upsertContactFromApi` u seznamu s `opt_in = 'double'` a volbou `pending` má nově vydat
token a odeslat potvrzení. Nejlevnější řešení bez duplikace logiky: v takovém případě
delegovat na `subscribeToList` místo přímého `writeSubscriptionIn`. Volba `confirmed`
zůstane, jak je (správce se prohlášením zaručuje za souhlas), jen k ní doplnit poctivý
text a viditelně ukázat opt-in vybraného seznamu.

### Co zbývá u systémové pošty

Reset hesla, pozvánky a ověření adresy pořád jedou přes SMTP a projektu jen se SES
neodejdou. Řeší se to stejným tahem (přesunout `DefaultSystemMailer` na outbox), ale je to
jiný rozsah a jiný plán. Sem to nepatří, jen ať se na to nezapomene.

## 3. Nastavení e-mailů na seznamu

### Rozhodnutí: odkaz na šablonu v knihovně, ne pole „předmět a text"

Sendy má pole s předmětem a textem, protože nemá editor. My ho máme, a hlavně:

- **Schéma s tím počítá.** `lists.confirmation_template_id` a `lists.welcome_template_id`
  existují od migrace 0001 (`packages/db/src/schema/contacts.ts:310`) a
  `packages/core/src/templates/repository.ts:381` už umí vypsat, kde se šablona používá,
  v rolích `confirmation` a `welcome`. Chybí jen API a obrazovka.
- **Formuláře to tak už dělají.** `delivery_template_id` plus tlačítko, které založí
  šablonu `kind: 'transactional'` a rovnou ji připojí
  (`apps/web/src/features/forms/actions.ts:99`). Druhý vzorec pro tutéž věc by byl matoucí.
- **Odesílací cesta stejně potřebuje `Document`.** Prosté pole s textem by znamenalo druhý
  renderer, druhou validaci a druhou cestu k merge tagům.
- **Předmět už v šabloně je**, řeší ho `subjectFor(template.name, document)`. Není potřeba
  samostatný sloupec.

Volitelnost se tím neztrácí, naopak. `NULL` znamená „použije se obecné znění", což je přesně
Sendyho prázdné pole. Obecné znění bude **konstanta typu `Document` v TS**, ne seedovaný
řádek v databázi, aby nevznikala kopie u každého projektu a aby se dalo vylepšit deploym.

Na obrazovce seznamu pak u každého e-mailu stojí dvě volby: „obecné znění" (výchozí,
s náhledem) a „vlastní e-mail", což je tlačítko, které založí šablonu předvyplněnou tím
obecným zněním a otevře editor. Přesně jako u formulářů.

### Sloupce na `lists`

| Sloupec | Stav |
|---|---|
| `confirmation_template_id` | existuje, jen se neplní |
| `welcome_template_id` | existuje, jen se neplní |
| `send_welcome` (bool, default `false`) | existuje, **už je to ten volitelný přepínač** |
| `goodbye_template_id`, `send_goodbye` | **nové**, migrace |
| `confirm_redirect_url`, `unsubscribe_redirect_url` | **nové**, viz kapitola 5 |

Uvítací e-mail je tedy volitelný už dnes na úrovni dat, `subscribe.ts:317` posílá welcome
jen při `list.sendWelcome === true`. Stačí to zpřístupnit v rozhraní.

Cizí klíče na `templates` u obou stávajících sloupců **chybí i v migracích** (jediný
`REFERENCES templates` je v `0015_forms_delivery_template.sql`). Doplnit
`ON DELETE SET NULL`, ať smazaná šablona nezanechá viset neplatné ID.

### Obrazovka

Dnes v UI **nejde seznam ani založit** (tlačítko `lists.create` v `lists-table.tsx:45`
nemá akci) a nastavit jdou jen čtyři věci. Rozšířit `list-detail.tsx` a `PatchListSchema`
o: `name`, `description`, `confirmation_ttl_hours`, `confirmation_max_resends`,
`send_welcome`, `send_goodbye` a tři ID šablon. Plus obrazovka „nový seznam".

### Závora: potvrzovací e-mail bez odkazu na potvrzení

V produktu už je obdobné pravidlo S4 `content_missing_unsubscribe`
(`packages/emails/src/document/semantic-fields.ts:133`). Nová kontrola: dokument, který je
připojený jako potvrzovací e-mail, musí obsahovat odkaz na `{{ data.confirm_url }}`.

Vynutit ji na dvou místech, protože „je to potvrzovací e-mail" je vlastnost vazby, ne
šablony samotné:

1. `PATCH /api/v1/lists/{id}` odmítne připojit šablonu bez odkazu (chyba `422`).
2. Uložení šablony, která už jako potvrzovací připojená je, odmítne stejnou kontrolou.

V editoru k tomu patří varování, aby to uživatel viděl dřív než na uložení.

## 4. Kontakty mimo seznamy

**Souhlasím se schváleným směrem a doporučuju ho tak nechat.** Tvrdé omezení ve schématu
by rozbilo import (seznam je v průvodci nepovinný, `step-options.tsx:71`), transakční API
(`resolveContact` zakládá kontakt bez souhlasu i bez seznamu) a `forms/submit.ts`, který
při prázdném `list_ids` jen zapíše kontakt.

Praktický důvod navíc: **výchozí seznam je z poloviny hotový a nikdo ho nepoužívá.**
Sloupec `lists.is_default`, `setDefault()`, `getDefault()` i endpoint
`POST /lists/{id}/default` existují, ale `getDefault()` nemá mimo test jediného volajícího
a z webu ten endpoint nikdo nevolá. `createWorkspace` žádný seznam nezakládá.

Plán:

1. `createWorkspace` založí seznam „Odběratelé" s `is_default = true` a `opt_in = 'double'`.
2. Ruční přidání kontaktu i průvodce importem ho mají předvybraný.
3. Když uživatel výběr zruší, ukáže se věcný text: „Kontakt nebude v žádném seznamu.
   Nepůjde mu poslat kampaň, dokud ho do nějakého nepřidáte."
4. `forms/submit.ts` při prázdném `list_ids` **nechat, jak je**. Formulář bez seznamu je
   legitimní (sběr adres pro e-book) a tichý zápis do výchozího seznamu by byl souhlas,
   který nikdo nedal.

Bod 4 je jediné místo, kde se odchyluju: fallback na výchozí seznam ano u ručních cest,
ne u veřejného formuláře.

## 5. Přesměrování a rozsah odhlášení

### Rozsah odhlášení: nepřidávat přepínač na seznam

Produkt to už řeší, a to na dvou místech dohromady lépe než Sendy:

- Rozsah tokenu se odvozuje z publika kampaně
  (`apps/web/src/features/campaigns/unsubscribe-scope.ts:36`): jeden seznam v publiku dá
  rozsah „seznam", segment dá volbu pro uživatele. Uloženo v `campaigns.unsubscribe_list_id`.
- Stránka `/u/{token}` u rozsahu „seznam" nabízí **dvě tlačítka**, „odhlásit z tohoto
  seznamu" a „odhlásit ze všeho" (`apps/web/src/features/public/pages.tsx:156`),
  a totéž umí centrum předvoleb.

Třetí místo, kde se totéž nastavuje, by z toho udělalo hádanku. **Doporučení: neimplementovat.**

### Přesměrování

| Situace | Stav |
|---|---|
| Po odeslání formuláře | **hotovo** (`forms.redirect_url`, `submit.ts:90`), jen to není v UI |
| Po potvrzení `/s/c/{token}` | chybí, přidat `lists.confirm_redirect_url` |
| Po odhlášení `/u/{token}` | chybí, přidat `lists.unsubscribe_redirect_url` |
| „Už jste přihlášený" | **nedělat**, viz níže |

`forms.redirect_url` a `success_message` jsou v API i ve schématu, ale v editoru formuláře
nejsou vůbec (`apps/web/src/features/forms/types.ts:26` je ani nenese). To je nejlevnější
položka celého plánu: doplnit dvě pole do existujícího editoru.

**Proč „už jste přihlášený" nedělat.** `subscribe()` má pravidlo 3: odpověď je vždy stejná,
ať kontakt v databázi je, nebo není. Vlastní přesměrování pro už přihlášenou adresu by
z formuláře udělalo nástroj na ověřování, kdo je v databázi, a shodilo by rozhodnutí,
kvůli kterému je ta logika napsaná.

## 6. Pořadí prací

### Bez toho to nefunguje

| # | Práce | Odhad |
|---|---|---|
| 1 | Port `subscription-emails.ts` přes outbox, vestavěná výchozí znění, `data.confirm_url`, registrace v `instrumentation.ts` a ve workeru | 2–3 dny |
| 2 | Ruční přidání kontaktu: u dvojího opt-inu jít přes `subscribeToList`, ukázat opt-in seznamu, poctivé texty | 1 den |
| 3 | API a obrazovka nastavení seznamu (šablony, `send_welcome`, TTL, limit přeposlání) plus zakládání seznamu | 2 dny |
| 4 | Závora „potvrzovací e-mail musí obsahovat odkaz" na obou místech | 1 den |

### Doladění

| # | Práce | Odhad |
|---|---|---|
| 5 | Výchozí seznam projektu a jeho předvýběr při ručním přidání i importu | 1 den |
| 6 | Rozloučení: migrace `goodbye_template_id`, `send_goodbye`, odeslání z `unsubscribe.ts` | 1 den |
| 7 | Přesměrování: `confirm_redirect_url`, `unsubscribe_redirect_url`, plus `redirect_url` a `success_message` do editoru formuláře | 1 den |
| 8 | Cizí klíče `ON DELETE SET NULL` na tři sloupce se šablonami | 0,5 dne |

Dohromady zhruba **9–10 dní**, z toho 6–7 na část, bez které produkt slibuje e-mail
a neposílá ho.

## 7. Otázky pro zadavatele

> **ROZHODNUTO ZADAVATELEM 2026-08-05.** Všech šest otázek má odpověď, staví se
> podle nich. Znění otázek níž zůstává, aby bylo vidět, proti čemu se rozhodovalo.
>
> 1. **Ruční přidání na seznam s dvojím potvrzením: nechat, jak je.** Výchozí
>    volba zůstává „rovnou přihlásit", protože ručně se přidávají lidé, o kterých
>    zadavatel ví. Platí ale druhá půlka doporučení: když se zvolí „nepotvrzený",
>    potvrzovací e-mail se musí SKUTEČNĚ poslat. Dnes se neposílá ani tehdy.
> 2. **Vlastní znění e-mailu zakládá šablonu: ANO**, jedním tlačítkem
>    a předvyplněnou. Textové pole s předmětem a tělem se nedělá.
> 3. **Rozloučení po odhlášení: ANO**, s výchozím stavem vypnuto.
> 4. **Výchozí seznam „Odběratelé" v novém projektu: ANO**, včetně odchylky
>    z plánu: fallback na něj platí u ručních cest a importu, **ne u veřejného
>    formuláře**. Tichý zápis do seznamu při prázdném `list_ids` by byl souhlas,
>    který nikdo nedal.
> 5. **Rozsah odhlášení se na seznam nepřidává: POTVRZENO.** Řeší se už na dvou
>    místech (rozsah tokenu z publika kampaně a volba na veřejné stránce),
>    třetí by z toho udělalo hádanku.
> 6. **Systémová pošta přes SES jako samostatný úkol hned potom: ANO.**
>    Zadavatel k tomu řekl doslova „určitě, nesmí se na to v žádném případě
>    zapomenout", viz kapitolu 8.


1. **Ruční přidání na seznamu s dvojím opt-inem.** Má se výchozí volba překlopit na
   „poslat potvrzovací e-mail", nebo zůstat na „rovnou přihlásit"?
   *Doporučuju*: nechat výchozí „rovnou přihlásit" (správce se za souhlas zaručuje
   prohlášením a je to nejčastější případ), ale u volby „nepotvrzený" e-mail skutečně
   poslat a napsat to k tomu. Tvoje ruční přidání by pak fungovalo tak, jak jsi čekal.

2. **Šablona z knihovny místo pole „předmět a text".** Je pro tebe přijatelné, že vlastní
   znění potvrzovacího e-mailu znamená založit šablonu (jedním tlačítkem, předvyplněnou)?
   *Doporučuju*: ano, kapitola 3. Kdyby ti to přišlo těžké, alternativa je pole na jednu
   větu, která se vloží do obecné šablony. Nejde to ale rozšířit na plnou úpravu vzhledu.

3. **Rozloučení po odhlášení.** Chceš ho vůbec? Část odesílatelů ho záměrně neposílá,
   protože po odhlášení už poslaný e-mail bývá vnímaný jako drzost.
   *Doporučuju*: udělat, výchozí stav vypnuto, stejně jako uvítání.

4. **Výchozí seznam v novém projektu.** Založit „Odběratelé" automaticky?
   *Doporučuju*: ano. Bez něj dnes v rozhraní seznam nezaložíš vůbec.

5. **Rozsah odhlášení na seznamu.** Potvrzuješ, že se nepřidává?
   *Doporučuju*: nepřidávat, kapitola 5.

6. **Systémová pošta a SES.** Reset hesla a pozvánky ti dnes taky neodejdou. Řešit hned
   po tomhle plánu jako samostatný úkol?
   *Doporučuju*: ano, hned poté. Je to stejný tah (outbox místo přímého SMTP) a bez něj
   nefunguje pozvání kolegy.


---

## 8. NAVAZUJÍCÍ ÚKOL, KTERÝ SE NESMÍ ZTRATIT: systémová pošta přes SES

Zadavatel ho výslovně označil za nezapomenutelný, proto má vlastní kapitolu
a ne jen odrážku v otázkách.

**Stav dnes.** `SYSTEM_MAIL_CAPABLE_TYPES = ['smtp']`
(`packages/core/src/platform/system-mail-config.ts:33`). Systémová pošta tedy
umí jedině SMTP účet. Kdo má nastavené jen SES, a to je výchozí stav po
průvodci instalací, nedostane ze systémové pošty nic.

**Co tím dnes nefunguje.** Pozvánka kolegy do projektu, obnova hesla
a všechno ostatní, co jde mimo kampaně a mimo outbox. Uživatel přitom vidí
v rozhraní úspěch, protože odeslání skončí bez chyby.

**Proč to není součást tohohle plánu.** E-maily seznamu se podle kapitoly 2
posílají outboxem, tedy cestou, kterou obsluhuje Go sender a která SES umí.
Systémová pošta jde jinudy a její převedení je vlastní práce s vlastními
rozhodnutími (odesílatel systémových zpráv, chování při nenastaveném účtu,
co s frontou při výpadku). Slepit to do jednoho plánu by znamenalo, že se
ani jedno neudělá pořádně.

**Podmínka převzatá odjinud:** systémová pošta nesmí nést odhlašovací odkaz
ani hlavičku `List-Unsubscribe`, stejně jako transakční pošta. Pravidlo i jeho
důvod jsou v `docs/superpowers/specs/2026-08-05-transakcni-maily-pruzkum.md`.
