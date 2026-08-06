# Transakční e-maily přes API: průzkum a návrh

Datum: 5. 8. 2026
Typ: průzkum a návrh, žádný produkční kód
Rozsah: transakční pošta **zákazníka pro jeho vlastní uživatele** (uvítací mail, reset hesla, potvrzení objednávky), ne systémová pošta samotného nástroje

---

## Stav k 6. 8. 2026: NEJMENŠÍ UŽITEČNÁ VERZE JE POSTAVENÁ

Tohle byl průzkum, ne plán. Postavilo se podle něj a **devět z deseti položek
kapitoly 11.1 je hotových**. Dokument dál platí jako popis rozhodnutí a rizik,
ale **jako seznam práce už ne**. Čti ho s tímhle v ruce.

| # | Práce z 11.1 | Stav a důkaz |
|---|---|---|
| 1 | Kořen `data` v Liquidu | **hotovo**, `packages/contracts/src/liquid/grammar.ts:53` plus `rootsForTemplateKind()`, která `data` pouští jen do šablon s `kind = 'transactional'` |
| 2 | `buildRenderSchema` sbírá cesty z URL polí (R1) | **hotovo**, `packages/emails/src/compile/render-schema.ts` (`addUrlField(node.href)`, `urlFieldsOf(block)`) |
| 3 | `validateHref` respektuje `trackable` | **hotovo**, `link-control.tsx:31` bere `options.trackable` a při `false` Liquid propustí |
| 4 | `messages.kind = 'transactional'` | **hotovo**, `MESSAGE_KINDS` i migrace `0016_message_kinds.sql` (přidala rovnou i `automation`, viz O7) |
| 5 | Samostatná claim smyčka (R2) | **hotovo**, `StmtClaimNonCampaignBatch` s `kind <> 'campaign'` a `Claimer` v `apps/sender/internal/app/loop.go`, dávka `SENDER_NON_CAMPAIGN_BATCH_SIZE` (výchozí 20) |
| 6 | Vypnutí odhlašovacího odkazu a `List-Unsubscribe` | **hotovo**, `Renderer.unsubscribe` vrací pro transakční druh prázdný řetězec bez chyby, `NO_UNSUBSCRIBE_MESSAGE_KINDS` v kontraktu |
| 7 | Rozlišení tvrdých a marketingových důvodů suppression | **hotovo na obou stranách**, `contacts/suppression/transactional.ts` a `transactionalBlocks()` v `apps/sender/internal/outbox/suppression.go` (komentáře se na sebe navzájem odkazují) |
| 8 | Scope, endpoint, upsert kontaktu, nosná kampaň, chybové kódy, OpenAPI | **hotovo**, `transactional:send` v `PERMISSIONS` (test fixuje 49 oprávnění), `packages/core/src/transactional/`, kódy `template_kind_not_transactional`, `recipient_suppressed`, `transactional_data_too_large`, `transactional_variable_unknown`, `sender_identity_not_found` |
| 9 | Limit klíčovaný na workspace | **hotovo**, pravidlo `transactional_send` (60 za minutu) v `apps/web/src/lib/api/rate-limit.ts:83` |
| 10 | Testy | `packages/core/src/transactional/transactional.db.test.ts` a další |

**Co z dokumentu zbývá jako otevřená práce:**

- **`GET /api/v1/transactional/{message_id}` neexistuje.** Router má jedinou cestu,
  `POST /transactional`. Kapitola 9.2 s ním počítá, stav zprávy se dnes dá zjistit
  jen odchozími webhooky.
- **Sloupec `sender_identities.purpose` nevznikl** (kapitola 8.2 a 11.4 C). Oddělení
  marketingového a transakčního proudu se dá nastavit ručně druhým providerem
  a vlastní subdoménou, ale endpoint nemá jak vybrat „transakční" identitu podle
  příznaku.
- **Příchozí webhook (kapitola 7) dál nemá HTTP endpoint ani UI.** Datová vrstva
  `packages/core/src/contacts/inbound/` je pořád jen mapování, podpis a cesta.
- **Rozpad reportů podle proudu a prahy doručitelnosti zvlášť** (kapitola 8.2) hotové nejsou.

**Nález mimo zadání, který sám sebe vyřešil:** `delivery-email.ts` už kontroluje
suppression i přes `fingerprint` (R10), komentář na řádku 86 to zdůvodňuje.

---

## Shrnutí pro zadavatele (deset řádků)

> **Neplatí od 6. 8. 2026: skoro celé shrnutí v přítomném čase.** Popisuje stav
> před implementací. Endpoint `POST /api/v1/transactional` stojí (bod 1), čtyři
> brány z bodu 2 jsou opravené, kontrakt i `messages.kind` rozšířené, odhlašovací
> pojistka v Go má výjimku pro transakční druh, suppression rozlišuje důvody
> a claim smyčka pro zprávy mimo kampaň běží. Scopes je dnes 49, ne 48.
> Podrobnosti v tabulce nahoře. Bod 6 platí dál a bod 10 se potvrdil: odhad seděl
> a koordinace s P17 proběhla jednou migrací (`0016_message_kinds.sql`).

1. API je správná volba a je na něj postaveno prostředí: Hono + OpenAPI, 48 granulárních scopes, RFC 9457 chyby, idempotence i rate limit už existují. Endpoint `POST /api/v1/transactional` ale postavený není.
2. Jádro dotazu, tedy odkaz do tlačítka, dnes **nefunguje na čtyřech nezávislých místech naráz**. Není to jedna chyba, jsou to čtyři.
3. Zmrazený Liquid kontrakt zná jen sedm kořenů (`contact`, `campaign`, `workspace` a čtyři systémové URL). `{{ reset_url }}` je `liquid_unknown_root` a shodí kompilaci. Chybí kořen pro data předaná při volání.
4. Editor v UI odmítne uložit jakoukoli proměnnou do pole URL, i když ji datový model připouští. Validace `validateHref` ani nekouká na to, jestli je odkaz sledovaný.
5. Sběrač použitých proměnných (`buildRenderSchema`) nikdy nečte `button.props.href`. I kdyby prošly první tři brány, tlačítko odejde s `href=""`, tiše, a náhled to neodhalí.
6. Měření prokliků naopak riziko nepředstavuje: dynamický odkaz architektonicky trackovat nejde, protože `campaign_links` drží pevnou URL na dvojici kampaň a pozice. Únik jednorázového tokenu do statistik je vyloučený. Doporučuji to zamknout výslovně, ne se spoléhat na vedlejší efekt.
7. Odesílač má **tvrdou pojistku**: zpráva bez `contact_id` neodejde a každá zpráva nese odhlašovací odkaz i hlavičku `List-Unsubscribe`. Pro reset hesla je obojí špatně a je to změna v Go, ne v TypeScriptu.
8. Suppression list dnes nerozlišuje marketingové odhlášení od tvrdého odrazu. Transakční proud musí ctít bounce, stížnost a GDPR výmaz, ale ne odhlášení z marketingu. To dnes nejde vyjádřit.
9. Odeslat se to má týmž outboxem, ale novou hodnotou `messages.kind = 'transactional'` a **vlastní claim smyčkou**. Dnešní smyčka by reset hesla nechala čekat, dokud se nedotočí běžící kampaň, tedy klidně desítky minut.
10. Nejmenší užitečná verze je odhadem 6 až 9 dnů práce a musí se koordinovat s plánem P17 (automatizace), protože sahá do týchž tří zmrazených míst.

---

## 1. Stav dnes

### 1.1 Co je hotové a použitelné

| Stavební kámen | Stav | Kde |
|---|---|---|
| REST API, Hono + `@hono/zod-openapi`, 185 cest | hotové | `apps/web/src/lib/api/openapi.ts`, routery v `packages/core/**/api/*.routes.ts` |
| API klíče, ověřování, rotace s grace obdobím | hotové | `packages/core/src/identity/api-key.ts`, `api-key-service.ts` |
| Granulární scopes (48 hodnot), zákaz wildcardu | hotové | `packages/core/src/identity/permissions.ts` |
| Idempotence přes `Idempotency-Key` | hotové, ale zapojené jen na 4 endpointech | `apps/web/src/lib/api/idempotency.ts`, tabulka `idempotency_keys` |
| Rate limit per API klíč | hotové | `apps/web/src/lib/api/rate-limit.ts` |
| Chyby RFC 9457 (`application/problem+json`) | hotové | `apps/web/src/lib/api/problem.ts`, `packages/core/src/errors/registry.ts` |
| Outbox `messages` + Go odesílač, retry, leasing, throttling | hotové | `packages/contracts/src/outbox.ts`, `apps/sender/**` |
| Vzor odeslání jedné zprávy mimo kampaň | hotové | `packages/core/src/contacts/forms/delivery-email.ts` |
| `templates.kind = 'transactional'` | existuje, ale ovlivňuje jen validační profil a filtr v UI | `packages/db/src/schema/content.ts:135`, `packages/core/src/templates/repository.ts` |
| Odesílací identity, domény, SES konfigurační sada | hotové | `sending_providers`, `sender_domains`, `sender_identities` |
| Odchozí webhooky (HMAC, retry, log) | hotové | `packages/core/src/platform/webhooks/**` |
| Příchozí webhook pro kontakty | **datová vrstva a mapování hotové, HTTP endpoint chybí** | `inbound_endpoints`, `packages/core/src/contacts/inbound/**` |

### 1.2 Co ve specifikaci stojí

`docs/superpowers/specs/2026-07-31-mailing-tool-spec.md:579` uvádí:

```
POST   /api/v1/transactional              transakční mail přes šablonu (fáze 2)
```

MVP 2 v téže specifikaci jmenuje „transakční e-maily přes API". Kontrakt outboxu (část 1, kapitola 4.10.1) navíc podle plánu P17 výslovně nechává „prostor pro `transactional`". Záměr tedy existuje, realizace ne.

### 1.3 Co dnes chybí, jedním pohledem

> **Neplatí od 6. 8. 2026.** Z celého seznamu níž zbývá jediná položka:
> **rozlišení účelu odesílací identity** (sloupec `sender_identities.purpose`).
> Všechno ostatní vzniklo, viz tabulka na začátku dokumentu.

- endpoint `POST /api/v1/transactional`
- scope pro odesílání jednotlivé zprávy (nejblíž je `campaigns:send`, ten ale umí i pozastavit a zrušit kampaň)
- hodnota `messages.kind = 'transactional'` (CHECK dnes zná jen `campaign` a `test`)
- kořen pro proměnné předané při volání (Liquid kontrakt je zmrazený)
- možnost neposlat odhlašovací odkaz a hlavičku `List-Unsubscribe`
- možnost odeslat na adresu, která není kontakt (`messages.contact_id` je `NOT NULL`)
- rozlišení typu suppression (marketingové odhlášení versus tvrdý odraz)
- prioritní fronta pro průběžnou zprávu

---

## 2. Volání přes API

### 2.1 Prostředí je připravené

Celé `/api/v1/**` běží jako jedna Hono aplikace mountnutá do catch-all handleru `apps/web/src/app/api/v1/[[...route]]/route.ts`. Přidání endpointu je rutina: `createRoute()` v novém `*.routes.ts` v `packages/core`, registrace v `buildApp()`, přegenerování `packages/contracts/openapi.json` a commit (CI brána `pnpm ci:openapi-drift` porovnává bajt po bajtu).

Povinné náležitosti podle testu `apps/web/test/api/openapi.test.ts`: každá operace musí mít aspoň jednu odpověď se stavem 400 a výš, se schématem `Problem`.

### 2.2 Ověření a oprávnění

Ověřování v `apps/web/src/lib/api/authenticate.ts`: `Authorization: Bearer ml_live_<prefix>_<secret>`, hledání podle `prefix`, SHA-256 nad sekretem, `timingSafeEqual`, dvě atrapová porovnání proti úniku informace časem. Rotace nechává starý sekret žít maximálně 24 hodin a odpověď nese hlavičku `ML-Key-Rotated: true`.

**Odpověď na otázku, jestli jde vydat klíč jen na transakční poštu: mechanismus ano, hodnota ne.**

Scopes jsou týž jmenný prostor jako oprávnění rolí, definované v `packages/core/src/identity/permissions.ts` (konstanta `PERMISSIONS`, 48 hodnot). Wildcard `*` je zakázaný, `assertScopes` v `api-key-service.ts` odmítne neznámý scope kódem `unknown_scope`. Vydat klíč s jedinou hodnotou tedy jde už dnes.

Chybí ale hodnota, která by znamenala právě jen odeslání transakční zprávy. `campaigns:send` je příliš široký: gatuje i `/campaigns/{id}/pause`, `/resume`, `/cancel`, `/undo`. Klíč v aplikaci zákazníka, který má poslat reset hesla, by tím mohl zastavit běžící rozesílku.

**Doporučení:** přidat `transactional:send` do `PERMISSIONS` a do `ROLE_PERMISSIONS` (owner, admin, editor). Název záměrně nekopíruje `messages:send`, protože `messages` je v produktu název outboxové tabulky a pletlo by se to.

### 2.3 Idempotence

Infrastruktura je hotová a dobře navržená: `withIdempotency` v `apps/web/src/lib/api/idempotency.ts`, tabulka `idempotency_keys` s PK `(workspace_id, key)`, fingerprint SHA-256 nad `method + path + kanonické JSON tělo`, TTL 24 hodin, úklidový job `cleanup_idempotency`.

Chování, které z toho plyne a které je pro transakční poštu přesně to, co chceme:

- stejný klíč a stejné tělo do 24 hodin: vrátí uloženou odpověď, hlavička `Idempotent-Replay: true`, **druhý mail neodejde**
- stejný klíč a jiné tělo: 409 `idempotency_key_reuse`
- souběžné volání do 60 sekund: 409 `idempotency_request_in_progress` s `Retry-After: 2`

**Doporučení: hlavička `Idempotency-Key` musí být u transakčního endpointu povinná**, ne volitelná. Runner `setIdempotentRunner` ji u POST vyžaduje automaticky. Je to jediná ochrana proti tomu, aby retry v aplikaci zákazníka poslalo uživateli reset hesla třikrát.

Varování: hlavička je dnes na řadě endpointů dokumentovaná v OpenAPI, ale kód ji ignoruje (`contacts.routes.ts`, `lists.routes.ts`, `workspaces.routes.ts` deklarují `IdempotencyHeaderSchema`, ale `runIdempotent` nevolají). U transakčního endpointu to nesmí dopadnout stejně, protože tady je následek viditelný uživateli zákazníka.

### 2.4 Limity

Dnešní limity jsou `api_key_read` 1000 za minutu a `api_key_write` 300 za minutu, klíčované **podle ID klíče, ne podle workspace**. Deset klíčů znamená desetinásobný strop. Pro transakční poštu je to málo přísné z pohledu doručitelnosti a zároveň možná málo štědré z pohledu zákazníka s vysokým provozem.

Pozn.: v katalogu už existují pravidla `campaign_send` a `contacts_import`, ale **nikdo je nekonzumuje**, jsou mrtvá. Odeslání kampaně tedy dnes limitované není vůbec.

Druhé varování: backend `postgres` záměrně hází výjimku, protože chybí tabulka `platform.rate_limits` ve tvaru, který knihovna chce. Ve výchozím `memory` režimu je při více instancích skutečný strop násobkem počtu instancí.

**Doporučení:** samostatné pravidlo `transactional_send`, klíčované na **workspace**, ne na klíč. Výchozí hodnota řádově 60 za minutu a k tomu denní strop odvozený od kvóty providera (`sending_providers.quota_max_24h`). Skutečný strop stejně drží token bucket v Go podle `quota_max_send_rate`, tohle je ochrana před tím, aby smyčka v cizí aplikaci vyžrala denní kvótu SES za pět minut.

---

## 3. Proměnné a odkaz do tlačítka

**Tohle je jádro dotazu a je tu nejvíc práce. Dnes to nefunguje na čtyřech místech nezávisle na sobě.**

> **Neplatí od 6. 8. 2026: všechny čtyři brány jsou opravené.** Kapitola zůstává
> jako popis toho, proč se to muselo opravit na čtyřech místech naráz, a jako
> návod, kam sáhnout, kdyby se to znovu rozešlo. Konkrétně: brána 1 kořenem `data`
> a funkcí `rootsForTemplateKind`, brána 2 vypnutým sledováním v transakčním
> profilu, brána 3 parametrem `trackable` ve `validateHref`, brána 4 sběrem
> URL polí v `buildRenderSchema`.

### 3.1 Brána první: zmrazený seznam kořenů

`packages/contracts/src/liquid/grammar.ts:45`:

```ts
export const ALLOWED_ROOTS = [
  'contact',
  'campaign',
  'workspace',
  'unsubscribe_url',
  'one_click_unsubscribe_url',
  'preferences_url',
  'webview_url',
] as const;
```

`{{ reset_url }}` je `liquid_unknown_root`. Blok komentáře v souboru začíná slovem ZMRAZENO, takže rozšíření není drobnost, je to změna kontraktu se všemi důsledky: Go zrcadlo v `apps/sender/internal/liquidx/**`, 55 golden fixtur v `packages/contracts/fixtures/liquid/`, kontrola parity `packages/contracts/scripts/check-parity.ts`, duplicitní kopie seznamu v `packages/emails/src/document/semantic-fields.ts:39`.

Navíc invariant I1 (`packages/emails/src/compile/invariants.ts:41`) po kompilaci vytáhne z HTML všechny konstrukce a znovu je validuje **bez dodaných kořenů**, tedy proti výchozímu `ALLOWED_ROOTS`. Neznámý kořen tam neprojde ani oklikou.

Existující obchvat `contact.attr.reset_url` je **špatné řešení a nedoporučuji ho**: hodnota by se musela zapsat do kontaktu, tedy do sdíleného stavu. Dva souběžné resety hesla pro tutéž adresu by si přepsaly token a jeden uživatel by dostal odkaz druhého. To je bezpečnostní chyba, ne jen nešikovnost.

**Doporučení: nový kořen `data`, tedy `{{ data.reset_url }}`.** Jméno je krátké, nekoliduje s ničím a čitelně říká „přišlo to při volání". Musí být povolený jen v šablonách s `kind = 'transactional'`, aby kampaňová šablona nemohla odkazovat na něco, co jí nikdo nedodá.

### 3.2 Brána druhá: proměnná ve sledovaném odkazu je chyba

`packages/emails/src/document/semantic-structure.ts:184`:

```ts
if (SYSTEM_URL_TAG.test(trimmed)) return;
if (HAS_LIQUID.test(trimmed)) {
  issues.push(
    trackable
      ? issue('liquid_in_trackable_href', 'error', pointer)
      : issue('link_variable_not_tracked', 'warning', pointer),
  );
  return;
}
```

Výchozí `trackable` u tlačítka je `true` (`apps/web/src/features/editor/descriptors/button.ts:112`), takže bez zásahu je to **blokující chyba**. Golden fixture `packages/contracts/fixtures/compiled/CT-012.json` to fixuje.

Když se sledování vypne, je to jen varování. Kód `link_variable_not_tracked` ovšem není v `apps/web/src/features/editor/model/issue-codes.ts` ani v i18n, takže uživatel by uviděl syrový kód bez překladu.

**Doporučení:** u šablony `kind = 'transactional'` sledování odkazů netrackovat vůbec (viz kapitola 4) a varování `link_variable_not_tracked` v tomto profilu potlačit, protože tam je proměnná v odkazu normální stav, ne odchylka. Do i18n ho přesto doplnit, kvůli kampaním.

### 3.3 Brána třetí: editor proměnnou do URL neuloží

`apps/web/src/features/editor/components/properties/controls/link-control.tsx:13`:

```ts
export function validateHref(raw: string): 'ok' | 'scheme' | 'liquid' {
  const value = raw.trim();
  if (value === '' || SYSTEM_TAGS.includes(value)) return 'ok';
  if (value.includes('{{') || value.includes('{%')) return 'liquid';
  ...
}
```

a v `onChange`: `if (state === 'ok') onChange(next);`

Když validace neprojde, hodnota se **do dokumentu vůbec nezapíše**. `SYSTEM_TAGS` je přitom jen tříprvkový seznam přesných literálů včetně mezer. Funkce navíc **nebere v úvahu `trackable`**, takže i s vypnutým sledováním editor URL s proměnnou zahodí, přestože datový model to připouští. To je rozpor mezi UI a `semantic-structure.ts`.

Žádná Zod validace URL neexistuje, JSON schema má jen `{"type":"string","minLength":1,"maxLength":2000}`. Blokuje to výhradně tenhle React control.

**Doporučení:** `validateHref` musí dostat kontext (profil šablony a `trackable`) a v transakčním profilu Liquid s povoleným kořenem propustit. Ideálně s nabídkou proměnných, ne volným textem.

### 3.4 Brána čtvrtá, nejzákeřnější: proměnná v href se nedostane do dat

`packages/emails/src/compile/render-schema.ts` sbírá cesty pouze z `visibleWhen.field`, z inline uzlů `t === 'var'` v rich textových polích a ze systémových tagů v `<a href>`. **Nikdy nečte `button.props.href` ani `image.props.href`** (jediný výskyt slova `href` v souboru je na řádku 75 a týká se systémového tagu).

Důsledek řetězu:

1. cesta neskončí v `renderSchema.fields` ani v `CompileMeta.usedPaths`
2. `buildRenderData` (`packages/core/src/campaigns/audience/render-data.ts:43`) ji tedy nesnapshotne
3. render má `strictVariables: false`, takže chybějící proměnná je prázdný řetězec, ne chyba (kontrakt, fixtures LQ-003 a LQ-004)
4. **tlačítko odejde s `href=""`**, tiše, bez jediné chyby a bez varování

Náhled to neodhalí, protože `sampleRenderData` (`packages/emails/src/preview-data.ts`) dodává ukázková data nezávisle na `usedPaths`. Náhled ukáže funkční odkaz a odeslaný mail bude mít prázdný. Žádný test tenhle scénář nepokrývá.

**Tohle je nález, který by se jinak našel až v produkci, na resetu hesla.** Sběrač musí číst i URL pole, ne jen textová.

### 3.5 Escapování URL se nerozbije

Ověřeno: `escapeHtml` mění jen `& < > " '`. V atributu `href="..."` je `&amp;` korektní HTML a prohlížeč ho dekóduje zpět. Fixture `packages/contracts/fixtures/markers/MK-002.json` to fixuje pro `https://shop.cz/akce?a=1&amp;b=2`.

Totéž platí pro **hodnotu** proměnné: `createHtmlEngine()` má `outputEscape: htmlEscape`, takže `?t=a&b=c` v hodnotě vyjde jako `?t=a&amp;b=c` v atributu a prohlížeč vidí `&`. Apostrof se změní na `&#39;`, což je v atributu s dvojitými uvozovkami rovněž bezpečné.

Jediná past je textová verze mailu: `createTextEngine` neescapuje nic, což je správně, ale znamená to, že URL v textové části musí být validní sama o sobě.

**Závěr k bodu 2 zadání: ano, po opravě čtyř míst to půjde, a escapování překážka není. Bez opravy to nejde vůbec, a co je horší, třetí a čtvrtá brána selhávají tiše.**

---

## 4. Měření prokliků versus jednorázové odkazy

Tenhle bod se ukázal být lepší, než zadání předpokládalo, ale z jiného důvodu, než by se čekalo.

### 4.1 Jak měření funguje

Přepis je dvoufázový a HTML se nikdy neparsuje:

1. **kompilace v TS**: `collectLinks()` v `packages/emails/src/compile/links.ts` nahradí href značkou `https://track.mlain.invalid/c/<link_id>` a zapíše řádek do `campaign_links`
2. **odeslání v Go**: `markers.ReplaceLinks()` v `apps/sender/internal/markers/markers.go` vymění značku za `/t/c/<token>`

Token (`packages/contracts/src/token.ts`, ZMRAZENO) je HMAC-SHA256 podepsaný, **nešifrovaný**, nese `workspace_id`, `message_id`, `link_id` a `message_created_at`. **Cílovou URL v sobě nemá**, ta se bere výhradně z `campaign_links` podle `link_id`.

### 4.2 Proč riziko úniku tokenu do statistik neexistuje

`campaign_links` má `campaign_id NOT NULL` a unikát na `(workspace_id, campaign_id, position)`. `link_id` je deterministické UUIDv5 z `campaignId:position`. Cíl se drží v `campaign_links.url` jako **jedna pevná hodnota pro celou kampaň**.

Z toho plyne: **dynamický odkaz, který je pro každou zprávu jiný, tímhle mechanismem trackovat principiálně nejde.** Není kam ten cíl uložit, protože tabulka je per kampaň, ne per zpráva.

Architektura to navíc už dnes ošetřuje pojistkou: `isTrackableTarget()` (`links.ts:35`) vrací `false` pro cokoli, co obsahuje `{{` nebo `{%`. Odkaz s proměnnou se tedy nikdy nepřepíše na trackovací a jednorázový token se do `campaign_links` nedostane.

**Rizika ze zadání a jejich skutečný stav:**

| Riziko | Stav | Poznámka |
|---|---|---|
| Únik jednorázového tokenu do `campaign_links` a do reportu | **vyloučeno** | dynamický odkaz nejde trackovat, není kam uložit cíl |
| Skener spotřebuje token předběžným otevřením | **reálné, pokud by se trackovalo** | `/t/c/` klasifikuje HEAD a známé skenery (`Safelinks|ProofPoint|Mimecast|Barracuda|urldefense|Symantec|FireEye`), ale **redirect provede vždy**, klasifikace jen ovlivní statistiku |
| Dvojí přesměrování | **reálné, pokud by se trackovalo** | `/t/c/` odpovídá 302 a k tomu se pro `human` na registrované doméně přidává query parametr `ml_token`, což by se přilepilo k resetovací adrese |

Bod o skeneru stojí za zdůraznění: klasifikace na `scanner` je jen značka pro report. Kdyby resetovací odkaz šel přes `/t/c/`, Microsoft Safe Links by ho **skutečně otevřel** a jednorázový token by se spotřeboval dřív, než uživatel klikne. Tomu dnes brání jen to, že se odkaz s proměnnou netrackuje.

### 4.3 Co doporučuji

**Transakční pošta nesmí mít měření prokliků ani otevření, a nemá se to nechat na vedlejším efektu.**

- kompilovat transakční šablonu s `trackOpens: false, trackClicks: false`, tedy tak, jak to už dělá `packages/core/src/contacts/forms/delivery-email.ts:114` a `packages/core/src/templates/test-send.ts`
- žádné značky, žádný pixel, `campaign_links` se pro nosnou skrytou kampaň nikdy nezapíše
- pojistka v senderu existuje a je správná: `kind = 'test'` má sledování vypnuté natvrdo (`apps/sender/internal/app/worker.go:91`) a zbylá značka vede na chybu `MarkerNotReplaced`; nová hodnota `transactional` se musí chovat stejně

Cena za to je, že transakční pošta nebude mít míru prokliku. To je správný kompromis: u resetu hesla je proklik technicky nutný krok, ne signál zájmu, a měřit ho nemá smysl. Doručení, odraz a stížnost se přitom měřit budou dál, protože ty jdou přes události providera, ne přes přepis odkazů.

**Volitelné rozšíření později:** pokud by zákazník měření chtěl (typicky u uvítacího mailu, kde už to smysl dává), správná cesta je tabulka odkazů per zpráva, ne per kampaň, a výslovný opt-in per odkaz. Do nejmenší užitečné verze to nepatří.

---

## 5. Souhlas, odhlášení a blokace

Tady je největší koncepční rozpor s dnešním kódem.

### 5.1 Odhlašovací odkaz je dnes vynucený, a to natvrdo v Go

> **Neplatí od 6. 8. 2026.** Výjimka existuje a je vázaná na jednu hodnotu jednoho
> kontraktního sloupce: `Renderer.unsubscribe` vrací pro `IsTransactional()`
> prázdný řetězec bez chyby a hlavička `List-Unsubscribe` se nepíše. Kampaňová
> zpráva bez odhlášení dál neodejde. Vedlejší důsledek, který je potřeba znát:
> **e-maily seznamu jedou jako transakční**, takže `{{ unsubscribe_url }}`
> v uvítacím e-mailu vede do prázdna a produkt to při ukládání šablony odmítá
> (`contacts/lists/list-email-guards.ts`).

`apps/sender/internal/app/worker.go:242`:

```go
// Zpráva bez možnosti odhlášení odejít NESMÍ. Je to technická pojistka proti tomu,
// aby šlo z nástroje rozeslat něco, co nejde odhlásit.
func (r *Renderer) unsubscribe(h *campaign.Header, msg outbox.Message, isTest bool) (string, bool, error) {
	if msg.ContactID == nil {
		if isTest {
			return r.urls.TestUnsubscribe(), false, nil
		}
		return "", false, &RenderError{
			Code:    errcatalog.UnsubscribeURLMissing,
			Message: "zpráva nemá contact_id, odhlašovací token nejde sestavit",
		}
	}
	...
}
```

Hlavičku pak píše `apps/sender/internal/mimebuild/builder.go:111`, včetně `List-Unsubscribe-Post: List-Unsubscribe=One-Click` podle RFC 8058, kdykoli je v seznamu HTTPS URI.

Kromě toho:
- `packages/emails/src/emitter/blocks/footer.tsx:27` vkládá `{{ unsubscribe_url }}` do patičky
- preflight kampaně to vynucuje jako chybu `campaign_no_unsubscribe` (`packages/core/src/campaigns/api/preflight-view.ts:222`)
- `packages/core/src/templates/precheck.ts:54` má tutéž kontrolu

Jediná úleva, která už existuje: `validationProfileFor(kind)` vrací pro `kind = 'transactional'` profil, kde je chybějící odhlašovací odkaz **jen varování**, ne chyba (`packages/core/src/templates/repository.ts:88`). Validační vrstva je tedy připravená, odesílací není.

**Co je potřeba změnit:** `Renderer.unsubscribe` musí pro `kind = 'transactional'` vracet prázdný řetězec bez chyby a `mimebuild.Build` nesmí hlavičku napsat. Je to změna v Go a dotýká se pojistky, která je tam napsaná záměrně, takže musí být explicitní a otestovaná, ne obejitá.

Doporučuji zachovat `Auto-Submitted: auto-generated` a `X-Auto-Response-Suppress: All`, jak to dělá systémová pošta (`packages/core/src/platform/system-mail-templates.ts:145`), aby transakční mail nespouštěl automatické odpovědi. `Precedence: bulk` naopak **nepřidávat**, transakční mail hromadný není.

### 5.2 Příjemce musí být kontakt, a to je problém

`messages.contact_id` je `NOT NULL` (`packages/db/migrations/0003_partitioned_tables.sql:98`). Transakční zpráva na adresu, která v databázi kontaktů není, dnes technicky nejde vložit.

Dvě cesty:

**A. Zjemnit sloupec na nullable.** Čistší koncepčně, ale sahá do partitionované tabulky a do všech dotazů, které `contact_id` čtou. `message_events.campaign_id` je navíc `NOT NULL` a `flushTrackingEvents` bere `campaignId` ze zprávy, takže se to táhne dál.

**B. Kontakt při volání založit nebo dohledat.** Doporučuji tuhle. Endpoint přijme e-mail, upsertne kontakt (bez přihlášení do jakéhokoli seznamu, `status = 'active'`), a `contact_id` doplní. Zákazník tím dostane bonus, že uvidí transakční poštu v časové ose kontaktu, což je přesně to, co od nástroje čeká.

Pozor na následek: transakční volání by tím zakládalo kontakty. To je chování, které musí být viditelné a asi i přepínatelné (viz otázky pro zadavatele).

### 5.3 Blokovaná adresa: tvrdý odraz versus odhlášení z marketingu

**Tohle je nejdůležitější rozhodnutí celé kapitoly.**

> **Neplatí od 6. 8. 2026: „dnešní suppression list je jednolitý".** Rozlišení je
> zavedené a na obou stranách: `packages/core/src/contacts/suppression/transactional.ts`
> (funkce `transactionalVerdict`) a `transactionalBlocks()` v
> `apps/sender/internal/outbox/suppression.go`. Tabulka důvodů níž je závazný popis
> toho, co kód dělá, ne návrh. R9 (rozejití TS a Go) tím zůstává jako riziko údržby.

Dnešní suppression list je jednolitý. Důvody (`packages/core/src/contacts/suppression/rank.ts`):

```
gdpr_erasure > complaint > hard_bounce > ses_suppressed > global_unsubscribe
  > one_click_unsubscribe > soft_bounce_threshold > invalid > import > manual
```

Filtruje se na čtyřech místech: obálka segmentu (`packages/core/src/segments/compile/envelope.ts`), materializace outboxu, průběžná revokace a nakonec Go (`apps/sender/internal/outbox/suppression.go`, funkce `FilterSuppressed`). **Žádné z těchto míst důvod nerozlišuje.** Kdo se odhlásil z newsletteru, nedostane ani reset hesla.

To je pro transakční poštu špatně a je to zároveň právně nesprávně: odhlášení z marketingu není odvolání souhlasu se zpracováním, transakční sdělení je plnění smlouvy nebo oprávněný zájem.

**Doporučené chování transakčního proudu:**

| Důvod suppression | Transakční mail | Proč |
|---|---|---|
| `hard_bounce` | **blokovat** | adresa neexistuje, opakované odesílání ničí reputaci a vede k blokaci účtu u SES |
| `complaint` | **blokovat** | stížnost na spam se u AWS počítá napříč proudy, ignorovat ji je nebezpečné |
| `ses_suppressed` | **blokovat** | provider ji stejně odmítne |
| `invalid` | **blokovat** | syntakticky vadná adresa |
| `soft_bounce_threshold` | **blokovat** | opakované měkké odrazy jsou nakonec totéž co tvrdé |
| `gdpr_erasure` | **blokovat, bez výjimky** | výmaz je výmaz, tady žádný oprávněný zájem není |
| `global_unsubscribe` | **propustit** | odhlášení z marketingu, ne z transakční pošty |
| `one_click_unsubscribe` | **propustit** | totéž, jen jiným kanálem |
| `manual`, `import` | **propustit s varováním** | ruční blokace bývá marketingová, ale nemusí; nechat rozhodnout zákazníka nastavením |

K tomu jasně: transakční proud **neprochází bránou mailability** (`packages/core/src/contacts/mailable.ts`), tedy nekontroluje `list_subscriptions.status = 'confirmed'`, `contacts.status` ani snooze. Přesně tak se dnes chová i `delivery-email.ts`, který souhlas záměrně obchází a v komentáři to zdůvodňuje.

**Realizace:** rozdělit predikát `suppressedExistsSql(alias)` (`packages/core/src/contacts/suppression/predicate.ts`) na variantu „vše" a variantu „jen tvrdé důvody", a totéž v Go v `StmtSuppressionBatch` (`apps/sender/internal/outbox/statements.go:373`). Je to jedno místo v TS a jedno v Go, takže to není drahé, ale **musí se to udělat na obou stranách**, jinak sender propustí, co aplikace zablokovala, nebo naopak.

Pozn. k nálezu mimo zadání: `delivery-email.ts:81` kontroluje suppression jen přes `lower(email)`, **bez větve přes `fingerprint`**, na rozdíl od kanonického `suppressedExistsSql`. Kontakt po GDPR výmazu tou branou v TS projde a zachytí ho až sender. Transakční endpoint tuhle chybu nesmí zkopírovat.

### 5.4 Právní upozornění, které patří do produktu

Hranice mezi transakčním a marketingovým sdělením je právní, ne technická. „Vaše objednávka byla odeslána, a mrkněte na tyhle produkty" je marketing, i když to jde transakčním endpointem. Doporučuji to napsat do dokumentace API a do UI u zakládání transakční šablony, ne to jen mlčky umožnit. Odpovědnost nese zákazník, ale nástroj mu má říct, kde je čára.

---

## 6. Kudy se to má odeslat

**Doporučení: týmž outboxem `messages` a týmž Go odesílačem, ale novou hodnotou `kind = 'transactional'` a vlastní claim smyčkou.**

### 6.1 Proč outboxem

Argument je už napsaný v hlavičce `packages/core/src/contacts/forms/delivery-email.ts`, a je správný:

> JDE PŘES OUTBOX A PŘES SKRYTOU KAMPAŇ, ne přímo přes providera. Je to táž úvaha jako u testovacího odeslání šablony: mimo outbox by se obešel seznam potlačených adres, kvóty, sledování i rekonciliace a všechno by se muselo napsat podruhé.

Protipříklad, jak to vypadá jinudy: systémová pošta (`packages/core/src/platform/system-mailer.ts`) outbox obchází, umí **jen SMTP** (klient SES existuje jen v Go), nemá retry ani backoff, nekontroluje suppression a neobjeví se v žádné statistice. Pro poštu nástroje to stačí, pro poštu zákazníka ne.

### 6.2 Proč nová hodnota `kind`, a ne recyklovat `test`

Formulářová cesta dnes používá `kind = 'test'` s odůvodněním „zpráva mimo kampaň, ber ji přednostně". Pro transakční poštu je to nevhodné ze tří důvodů:

1. sender u `kind = 'test'` přidává hlavičku `X-Mlain-Test: 1`
2. `unsubscribe()` má pro test zvláštní větev s `TestUnsubscribe()` a `OneClick = false`
3. reporty a filtry by transakční poštu počítaly jako testovací

CHECK `ck_messages__kind` dnes zná jen `('campaign','test')` a `MESSAGE_KINDS` v `packages/contracts/src/outbox.ts:9` je součást zmrazeného kontraktu.

**Koordinace s P17:** plán automatizace (`docs/superpowers/plans/2026-08-05-p17-automatizace.md`) chce z týchž důvodů přidat hodnotu `automation` a třetí větev claimu. Doporučuji **jednu migraci, která přidá obě hodnoty**, a jednu společnou „ne-kampaňovou" claim větev parametrizovanou podle `kind`. Dvě nezávislé změny téhož zmrazeného CHECKu a téže smyčky by se srazily.

### 6.3 Zásadní nález o latenci: dnešní smyčka by reset hesla zdržela

> **Neplatí od 6. 8. 2026: nález je vypořádaný.** Zprávy mimo kampaň se claimují
> vlastní větví (`ClaimNonCampaignBatch`) v samostatném bloku `Tick`, nezávisle
> na dojíždění kampaňové rotace, a dávka je konfigurovatelná
> (`SENDER_NON_CAMPAIGN_BATCH_SIZE`, výchozí 20). Doporučení 1 a 2 z konce
> kapitoly jsou tím splněná, doporučení 3 (oddělený provider) zůstává na zákazníkovi.

`apps/sender/internal/app/loop.go:71` (funkce `ClaimLoop.Tick`):

1. `ActiveCampaigns()` naplní rotaci
2. `ClaimTestBatch(TestBatchSize)` **jednou**
3. potom `for { rotation.Next(); ClaimBatch(...) }`, dokud všechny kampaně nevrátí nula řádků

Zprávy jdou do kanálu `jobs` o kapacitě `2 * Concurrency` (`runtime.go:308`), takže claimer se na kanálu blokuje a tick trvá tak dlouho, jak dlouho se dávka odesílá.

**Důsledek: transakční zpráva vložená uprostřed rozesílky 10 000 zpráv čeká, dokud se nedotočí celý zbytek všech aktivních kampaní.** Při 14 zprávách za sekundu jsou to desítky minut. Pro reset hesla je to nepoužitelné.

Dva další zesilovače:
- `TestBatchSize` se v produkčním drátování **vůbec nenastavuje** (`runtime.go:138` předává jen `BatchSize`, `ClaimTTLSeconds`, `FilterBatch`), takže padá na default 20. Nad 20 čekajících zpráv na tik se zbytek posune na další tik.
- limiter je jeden token bucket **na providera**, takže transakční zpráva soutěží o povolenku s běžící kampaní i po claimnutí.

**Doporučení, v tomto pořadí:**

1. **Samostatná goroutina** pro ne-kampaňové zprávy s vlastním krátkým intervalem (řádově 1 sekunda), nezávislá na kampaňovém ticku. To je jádro opravy a bez něj nemá smysl dělat nic dalšího.
2. `TestBatchSize` skutečně drátovat a udělat z něj konfiguraci.
3. Zvážit **oddělený provider pro transakční proud** (viz kapitola 8), čímž se vyřeší i sdílený token bucket, protože ten je klíčovaný na `provider_id`.

Bod 1 doporučuji označit za **blokující pro vydání**. Transakční endpoint, který za provozu doručuje reset hesla za dvacet minut, je horší než žádný endpoint, protože zákazník ho nasadí a zjistí to až na svých uživatelích.

### 6.4 Nosič obsahu

Zpráva potřebuje odesílatele a zkompilované HTML. Sender je čte z `campaigns` dotazem `StmtCampaignHeader` (`statements.go:33`), tedy z kampaně, ne z identity.

Doporučuji převzít osvědčený vzor `upsertSystemCampaign` z `delivery-email.ts`: jedna skrytá kampaň `kind = 'system'`, `status = 'draft'` navždy, **na jednu transakční šablonu**, s inkrementem `revision` při přepisu kvůli cache hlavičky v senderu. Plán P17 volí totéž pro e-mailové uzly automatizace, takže by šlo sdílet jednu pomocnou funkci.

Alternativa, tedy vlastní tabulka nosičů, je čistší, ale znamená nový dotaz v Go a nový grant, což se pro nejmenší užitečnou verzi nevyplatí.

---

## 7. Ostatní možnosti kromě API

| Cesta | Stav v produktu | Výhody | Nevýhody | Verdikt |
|---|---|---|---|---|
| **REST API** | není, ale prostředí hotové | jednoznačné, synchronní potvrzení, idempotence, scopes, verzované OpenAPI | zákazník musí psát kód, potřebuje klíč a jeho správu | **hlavní cesta** |
| **Příchozí webhook** | `inbound_endpoints`, mapování, dedup i job **hotové**, HTTP endpoint chybí, UI chybí | zákazník nepíše kód, jen nastaví URL v e-shopu; deklarativní mapování payloadu (`packages/core/src/contacts/inbound/mapping.ts`) | dnes umí jen zakládat a přihlašovat kontakty, ne odesílat; asynchronní, volající nedostane ID zprávy; podpis a IP allowlist se musí nastavit ručně | **druhá vlna**, ale levná: chybí jen route a UI, plus rozšíření akcí o `send` |
| **Automatizace** | kód neexistuje, plán P17 je hotový a detailní | uvítací mail nebo série po přihlášení bez jediné řádky kódu na straně zákazníka | neumí a nemá umět jednorázovou zprávu s dynamickými daty, například reset hesla; spouštěč je událost, ne volání | **doplněk, ne náhrada**; pokryje uvítací mail, ne reset hesla |
| **Odeslání z formuláře** | **hotové**, `packages/core/src/contacts/forms/delivery-email.ts` | funguje dnes, ověřený vzor pro celý návrh | jen z formuláře nástroje, žádná vlastní data, sledování vypnuté | referenční vzor, ne obecné řešení |
| **SMTP relay pro cizí aplikaci** | **neexistuje a doporučuji nestavět** | univerzální, cizí aplikace často umí jen SMTP; nulová práce na straně zákazníka | v `go.mod` není žádná SMTP server knihovna, jediný SMTP server v repu je testovací atrapa (`apps/sender/internal/testsupport/fakesmtp.go`); znamená to vlastní MTA, autentizaci, ochranu před open relay a parsování cizího MIME; šablony a personalizace by se úplně obešly, protože obsah přijde hotový | **ne**, poměr užitku a rizika je špatný |
| **Přímá fronta** | `packages/core/src/queues/registry.ts` existuje | nejrychlejší na napsání | obchází HTTP vrstvu, tedy scopes, idempotenci i limity; použitelné jen uvnitř produktu | ne jako veřejné rozhraní |

**Závěr k bodu 6 zadání: API je opravdu nejjednodušší a zároveň nejsprávnější.** Nejbližší doplněk je příchozí webhook, protože je z devadesáti procent hotový a řeší zákazníky, kteří nechtějí psát kód. SMTP relay je jediná možnost, kterou doporučuji explicitně zamítnout.

---

## 8. Doručitelnost a oddělení proudů

### 8.1 Co produkt dnes umí

| Schopnost | Stav |
|---|---|
| Víc odesílacích účtů na workspace | **ano**, `sending_providers` je běžná tabulka, jen `is_default` je právě jeden |
| Víc domén | **ano**, `sender_domains`, unikát na `(workspace_id, lower(domain))` |
| Víc odesílacích identit (from adres) | **ano**, `sender_identities`, unikát na jméno, právě jedna výchozí |
| Víc SES konfiguračních sad | **nepřímo**: jedna sada na jeden řádek `sending_providers` (`configuration_set_name` v šifrované konfiguraci, výchozí `mlain-<workspaceSlug>`) |
| Výběr sady per kampaň nebo per zpráva | **ne** |
| Typy providerů | `('ses','smtp')`, uzavřený výčet, komentář v `packages/db/src/schema/campaigns.ts:36` říká, že rozšíření je jednořádková migrace |

Sender drží dispatchery v mapě `map[uuid.UUID]*registryEntry` s TTL 60 sekund (`apps/sender/internal/provider/registry.go`), takže jeden proces obsluhuje libovolně mnoho účtů současně. Throttle i circuit breaker jsou klíčované na `provider_id`.

### 8.2 Co doporučuji

**Oddělit proudy se dá už dnes, bez jediné migrace, a je to nejlepší poměr užitku a práce v celém dokumentu.**

Postup pro zákazníka:

1. založit **druhý řádek `sending_providers`** pro transakční proud, s vlastní konfigurační sadou (například `mlain-<slug>-tx`)
2. ověřit **vlastní subdoménu** v `sender_domains`, například `mail.shop.cz` pro marketing a `tx.shop.cz` pro transakční
3. založit `sender_identities` s touhle doménou a označit ji jako transakční
4. transakční skrytá kampaň (nosič) dostane `provider_id` toho druhého providera

Tím se automaticky získá:
- oddělená reputace domény a IP u SES
- oddělený token bucket, protože throttle je per `provider_id`, takže rozesílka na 10 000 lidí nezdrží reset hesla
- oddělené události, protože konfigurační sada je jiná, takže bounce rate transakčního proudu jde měřit zvlášť
- oddělený circuit breaker

Co k tomu chybí a co je potřeba dodělat:
- **`sender_identities` nemá příznak, k čemu identita slouží.** Doporučuji sloupec `purpose` s hodnotami `marketing` a `transactional` a právě jednu výchozí pro každý účel. Bez toho endpoint neví, kterou identitu vzít, když ji volající neurčí.
- v UI u nastavení odesílatelů vysvětlit, proč se to má oddělit; sám od sebe to zákazník neudělá
- do dashboardu doručitelnosti rozpad podle proudu (dnes se prahy 4 % a 0,1 % počítají dohromady)

**Prahy doručitelnosti:** dnes se automatická pauza spouští při 8 % odrazů a 0,3 % stížností. Pro transakční proud musí být prahy **přísnější**, protože tam je normální bounce rate blízko nule a jakýkoli růst znamená chybu v aplikaci zákazníka, například odesílání na neexistující adresy. Zároveň ale automatická pauza transakčního proudu je nebezpečná: pozastavit reset hesla je pro zákazníka horší než pozastavit newsletter. Doporučuji u transakčního proudu **hlásit hlasitě, ale nepozastavovat automaticky**, a pozastavení nechat na výslovném rozhodnutí.

---

## 9. Doporučený návrh endpointu

### 9.1 Tvar požadavku

```http
POST /api/v1/transactional HTTP/1.1
Authorization: Bearer ml_live_a1b2c3d4_<sekret>
Idempotency-Key: pwreset-8f3a12c9-2026-08-05T09-14-22Z
Content-Type: application/json
Accept-Language: cs

{
  "template_id": "0199a1f4-6c1e-7a3b-9d20-4f1e2c3b4a50",
  "to": {
    "email": "jan.novak@example.com",
    "name": "Jan Novák"
  },
  "data": {
    "reset_url": "https://shop.cz/reset?token=eyJhbGciOi...&uid=8472",
    "expires_in_minutes": 30,
    "first_name": "Jan"
  },
  "sender_identity_id": "0199a1f4-7b2d-7e4c-8a11-9c3d5e6f7a80",
  "reply_to": "podpora@shop.cz",
  "tags": ["password_reset"],
  "create_contact": true
}
```

Pravidla:

- `template_id` musí ukazovat na šablonu s `kind = 'transactional'`, jinak 422 `template_kind_not_transactional`
- `data` se dostane do `messages.render_data` pod kořen `data` a je v šabloně dostupné jako `{{ data.reset_url }}`; strop navrhuji 16 kB po serializaci
- `sender_identity_id` je volitelné, bez něj se vezme výchozí identita s `purpose = 'transactional'`
- `create_contact` řídí, jestli se neznámá adresa založí jako kontakt, nebo se vrátí 422 (viz otázka O3)
- `tags` slouží k rozpadu v reportu, ne k tagování kontaktu; navrhuji je držet zvlášť, aby se to nepletlo s `contact_tags`
- hlavička `Idempotency-Key` je **povinná**

Scope: `transactional:send`.

### 9.2 Odpověď při úspěchu

```http
HTTP/1.1 202 Accepted
Content-Type: application/json; charset=utf-8
RateLimit-Limit: 60
RateLimit-Remaining: 59
RateLimit-Reset: 47

{
  "message_id": "0199a1f5-1234-7abc-8def-0123456789ab",
  "status": "queued",
  "contact_id": "0199a1f5-2345-7bcd-9ef0-123456789abc",
  "created_at": "2026-08-05T09:14:23.512Z"
}
```

202, ne 201: odeslání je asynchronní, `messages.status` je v tu chvíli `pending`. Stav se dá dohledat přes `GET /api/v1/transactional/{message_id}`, který vrátí `status`, `sent_at`, `error_code` a `provider_message_id`. Doručení, otevření, odraz a stížnost chodí odchozími webhooky, které už existují (`message.delivered`, `message.bounced`, `message.complained`).

### 9.3 Opakované volání s týmž klíčem

```http
HTTP/1.1 202 Accepted
Idempotent-Replay: true
Content-Type: application/json; charset=utf-8

{
  "message_id": "0199a1f5-1234-7abc-8def-0123456789ab",
  "status": "queued",
  "contact_id": "0199a1f5-2345-7bcd-9ef0-123456789abc",
  "created_at": "2026-08-05T09:14:23.512Z"
}
```

Druhý mail neodejde. Tělo je totožné, protože se přehrává uložená odpověď.

### 9.4 Chyby

Blokovaná adresa:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json; charset=utf-8

{
  "type": "https://docs.mlain.dev/errors/recipient_suppressed",
  "title": "Příjemce je zablokovaný",
  "status": 422,
  "detail": "Adresa je na seznamu blokovaných kvůli tvrdému odrazu.",
  "instance": "/api/v1/transactional",
  "code": "recipient_suppressed",
  "request_id": "01K9M2P3Q4R5S6T7U8V9W0X1Y2",
  "params": { "reason": "hard_bounce", "suppressed_at": "2026-07-28T11:02:44Z" }
}
```

Nové kódy do registru (`packages/core/src/errors/problem-codes.ts`):

| Kód | Stav | Kdy |
|---|---|---|
| `template_kind_not_transactional` | 422 | šablona není transakční |
| `template_not_compilable` | 422 | šablona nejde zkompilovat |
| `recipient_suppressed` | 422 | tvrdý důvod blokace, `params.reason` říká který |
| `transactional_data_too_large` | 413 | `data` přes 16 kB |
| `transactional_variable_unknown` | 422 | šablona chce `data.x`, které volání nedodalo, a nemá `| default:` |
| `sender_identity_not_found` | 422 | neexistuje výchozí transakční identita |
| `sending_not_configured` | 409 | workspace nemá připojeného providera |

Kód `transactional_variable_unknown` stojí za zdůraznění: **kontrakt Liquidu má `strictVariables: false`, chybějící proměnná je prázdný řetězec, ne chyba.** To je pro kampaň správně, pro reset hesla katastrofa, protože z toho vznikne `href=""`. Endpoint proto musí porovnat `usedPaths` šablony s klíči v `data` **před** vložením do outboxu a chybějící hlásit jako chybu volání. Předpokladem je oprava sběrače z kapitoly 3.4, protože bez ní `usedPaths` proměnné z URL vůbec neobsahuje.

### 9.5 Ukázka šablony

```
Tlačítko:
  label:     "Nastavit nové heslo"
  href:      {{ data.reset_url }}
  trackable: false   (v transakčním profilu vynucené)

Text:
  "Odkaz platí {{ data.expires_in_minutes }} minut."
```

---

## 10. Rizika

| # | Riziko | Závažnost | Ošetření |
|---|---|---|---|
| R1 | Tiché `href=""` kvůli nesebranému `usedPaths` z URL pole | **kritická**, projeví se až v produkci na resetu hesla | opravit `buildRenderSchema`, přidat golden fixture, přidat kontrolu `usedPaths` versus `data` v endpointu |
| R2 | Zdržení transakční zprávy za běžící kampaní o desítky minut | **kritická** | samostatná claim smyčka, blokující pro vydání |
| R3 | Změna zmrazeného kontraktu (kořeny Liquidu, `MESSAGE_KINDS`) rozejde TS a Go | vysoká | jedna migrace a jedna změna pro P17 i transakční poštu, kontrola parity `packages/contracts/scripts/check-parity.ts`, golden fixtury na obou stranách |
| R4 | Obejití odhlašovací pojistky v Go se použije i tam, kam nepatří | vysoká | povolit výhradně pro `kind = 'transactional'`, test, který ověří, že kampaňová zpráva bez odhlášení dál neodejde |
| R5 | Zákazník posílá marketing transakčním endpointem | vysoká, právní i doručitelnostní | dokumentace, upozornění v UI, sledování bounce a complaint rate transakčního proudu zvlášť |
| R6 | Zneužitý API klíč rozešle poštu na cizí adresy | vysoká | vlastní limit klíčovaný na workspace, denní strop podle kvóty providera, audit log volání, klíč jen se scopem `transactional:send` |
| R7 | Jednorázový token v odkazu spotřebuje skener | střední, dnes latentní | netrackovat transakční odkazy, pojistka `MarkerNotReplaced` v senderu |
| R8 | Transakční volání zakládá kontakty a nafukuje databázi | střední | `create_contact` jako výslovný přepínač, viditelné v UI |
| R9 | Suppression se v TS a v Go rozejde (rozdílné rozlišení důvodů) | střední | jeden predikát na každé straně, sdílená sada testovacích případů |
| R10 | `delivery-email.ts` kontroluje suppression bez větve přes `fingerprint`, endpoint to zkopíruje | střední | použít kanonický `suppressedExistsSql`, ne opsat |
| R11 | Limit per klíč, ne per workspace; v `memory` režimu se navíc násobí počtem instancí | střední | nové pravidlo klíčované na workspace; dořešit `platform.rate_limits` pro `postgres` backend |
| R12 | `components.securitySchemes` v `openapi.json` úplně chybí | nízká, ale trapná | doplnit, jinak si zákazník klienta z OpenAPI nevygeneruje s autorizací |

---

## 11. Co je hotové, co chybí, nejmenší užitečná verze

### 11.1 Nejmenší užitečná verze

Cíl: zákazník pošle reset hesla přes API, odkaz v tlačítku funguje, mail nenese odhlašovací odkaz, doručí se do sekund.

| # | Práce | Kde | Odhad |
|---|---|---|---|
| 1 | Kořen `data` v Liquidu, TS i Go, golden fixtures, parita | `packages/contracts`, `packages/emails`, `apps/sender/internal/liquidx` | 1 až 1,5 dne |
| 2 | `buildRenderSchema` sbírá cesty z URL polí (R1) | `packages/emails/src/compile/render-schema.ts` | 0,5 dne |
| 3 | `validateHref` respektuje profil a `trackable` | `apps/web/src/features/editor/.../link-control.tsx` | 0,5 dne |
| 4 | `messages.kind = 'transactional'`, migrace, kontrakt outboxu | `packages/db/migrations`, `packages/contracts/src/outbox.ts` | 0,5 dne |
| 5 | Samostatná claim smyčka pro ne-kampaňové zprávy (R2) | `apps/sender/internal/app/loop.go`, `outbox/statements.go` | 1 den |
| 6 | Vypnutí odhlašovacího odkazu a `List-Unsubscribe` pro transakční kind | `apps/sender/internal/app/worker.go`, `mimebuild/builder.go` | 0,5 dne |
| 7 | Rozlišení tvrdých a marketingových důvodů suppression, TS i Go | `contacts/suppression/predicate.ts`, `outbox/suppression.go` | 0,5 dne |
| 8 | Scope `transactional:send`, endpoint, upsert kontaktu, nosná skrytá kampaň, chybové kódy, OpenAPI | `packages/core/src/transactional/**`, `apps/web/src/lib/api/openapi.ts` | 1,5 až 2 dny |
| 9 | Limit klíčovaný na workspace | `apps/web/src/lib/api/rate-limit.ts` | 0,5 dne |
| 10 | Testy: unit, DB, golden, end to end na plné cestě | napříč | 1 až 1,5 dne |

**Celkem 8 až 10,5 dne.** Body 1 až 3 by se daly dělat paralelně s body 5 až 7, pokud na tom bude pracovat víc lidí.

### 11.2 Co do nejmenší verze nepatří

- UI pro zakládání transakční šablony nad rámec dnešního filtru
- report transakčního proudu (na začátek stačí odchozí webhooky a `GET /transactional/{id}`)
- příchozí webhook s akcí `send`
- odesílání příloh
- plánované transakční odeslání
- měření prokliků u transakční pošty

### 11.3 Poctivý odhad rizika odhadu

Nejistota je hlavně v bodech 1 a 5. Bod 1 sahá do zmrazeného kontraktu a do Go zrcadla, takže se tam dá strávit dvojnásobek času laděním parity mezi knihovnami. Bod 5 se dotýká claim smyčky, kde je spousta nenápadných invariantů kolem leasingu a rekonciliace. Zbytek jsou rutinní práce s jasným vzorem v `delivery-email.ts`.

Pokud se má něco odložit, ať je to bod 3, protože transakční šablonu jde na začátku spravovat přes API, ne editorem. Body 1, 2, 5 a 6 odložit nejdou, bez nich endpoint nedává smysl.

---

## 11.4 Dělení podle ceny změny (pro zadání implementace)

**A. Jde postavit hned, na dnešním kódu, bez migrace a bez zásahu do zmrazeného kontraktu:**

- endpoint, router, Zod schémata, registrace v `buildApp()`, přegenerování OpenAPI
- scope `transactional:send` (`PERMISSIONS` je běžná konstanta, ne zmrazený kontrakt)
- povinná `Idempotency-Key` (runner `setIdempotentRunner` už existuje a u POST hlavičku vyžaduje sám)
- nové chybové kódy v `packages/core/src/errors/problem-codes.ts`
- nosná skrytá kampaň podle vzoru `upsertSystemCampaign` z `delivery-email.ts`
- upsert kontaktu při volání
- oprava sběrače `buildRenderSchema` o URL pole (nález R1)
- oprava `validateHref` v editoru
- nové rate limit pravidlo klíčované na workspace
- oddělení proudů přes druhý `sending_providers` a vlastní subdoménu (jde nastavit už dnes, jen to nikdo neví)

**B. Vyžaduje změnu zmrazeného kontraktu, tedy TS i Go i golden fixtures i kontrolu parity:**

- kořen `data` v Liquidu (`packages/contracts/src/liquid/grammar.ts`, `ALLOWED_ROOTS`)
- hodnota `transactional` v `MESSAGE_KINDS` (`packages/contracts/src/outbox.ts`)

**C. Vyžaduje migraci databáze:**

- `ck_messages__kind` rozšířit o `transactional` (a podle rozhodnutí O7 zároveň o `automation`)
- sloupec `purpose` v `sender_identities` (`marketing` / `transactional`), aby endpoint věděl, kterou identitu vzít

**D. Vyžaduje změnu v Go a dotýká se záměrné pojistky, takže musí být explicitní a otestované:**

- `Renderer.unsubscribe` nesmí pro transakční kind hlásit chybu a `mimebuild.Build` nesmí psát `List-Unsubscribe`
- samostatná claim smyčka pro ne-kampaňové zprávy (nález R2)
- rozlišení tvrdých a marketingových důvodů v `StmtSuppressionBatch`

**Co je blokující pro vydání a nesmí se odložit:** A (oprava sběrače), B (kořen `data`), C (kind) a D (smyčka a odhlašovací odkaz). Bez kteréhokoli z nich endpoint buď nefunguje, nebo funguje tiše špatně.

**Co jde odložit bez ztráty užitku:** oprava `validateHref` v editoru (transakční šablona jde zpočátku spravovat přes API), report transakčního proudu, příchozí webhook s odesíláním, přílohy, plánované odeslání.

---

## 12. Otázky, které musí rozhodnout zadavatel

**O1. Kořen `data`, nebo jiné jméno?**
Navrhuji `{{ data.reset_url }}`. Alternativy: `{{ vars.reset_url }}`, `{{ params.reset_url }}`, nebo plochý zápis `{{ reset_url }}` s tím, že se pro transakční profil povolí libovolný kořen. Ploché řešení je pro zákazníka nejhezčí, ale rozbíjí kontrolu neznámého kořene, což je jedna z mála pojistek, které dnes chytí překlep v šabloně. **Doporučuji `data`.**

**O2. Kdy blokovat, kdy propustit?**
Souhlasíš s tabulkou v kapitole 5.3, tedy že tvrdý odraz, stížnost, GDPR výmaz a neplatná adresa blokují i transakční poštu, kdežto odhlášení z marketingu ne? Zvlášť stojí za rozhodnutí `manual` a `import`, kde nejde poznat záměr.

**O3. Má transakční volání zakládat kontakty?**
Navrhuji `create_contact: true` jako výchozí, protože bez `contact_id` zpráva technicky neodejde. Alternativa je vracet 422 a nutit zákazníka kontakt založit předem, což je čistší, ale otravnější.

**O4. Přísné, nebo mírné chování při chybějící proměnné?**
Navrhuji přísné, tedy 422 `transactional_variable_unknown`, když šablona chce `data.x` a volání ho nedodalo. Je to odchylka od kontraktu Liquidu, kde chybějící proměnná je prázdný řetězec. Mírná varianta pošle mail s prázdným odkazem, což je u resetu hesla horší než chyba.

**O5. Oddělený provider jako doporučení, nebo jako podmínka?**
Doporučit zákazníkovi vlastní subdoménu a vlastní konfigurační sadu, nebo to vynutit, tedy neodeslat transakční poštu, dokud si to nenastaví? Vynucení chrání doručitelnost, ale znatelně prodlužuje cestu k prvnímu odeslanému mailu.

**O6. Automatická pauza transakčního proudu?**
Marketing se dnes při 8 % odrazů pozastaví automaticky. U transakční pošty to znamená, že se uživatelům zákazníka zastaví reset hesla. Navrhuji hlásit hlasitě, ale nepozastavovat automaticky. Souhlasíš?

**O7. Pořadí vůči P17 (automatizace)?**
Obě práce sahají do `ck_messages__kind`, do `MESSAGE_KINDS` a do claim smyčky. Buď se udělá nejdřív společný základ (nová hodnota kindu plus samostatná smyčka) a pak obě nadstavby, nebo jedna z prací počká. **Doporučuji společný základ udělat jednou a nejdřív**, protože je to zhruba 1,5 dne, které se jinak zaplatí dvakrát a s rizikem konfliktu ve zmrazeném kontraktu.

**O8. Příchozí webhook s odesíláním jako druhá vlna?**
Datová vrstva je hotová, chybí HTTP endpoint a UI. Chceš to naplánovat hned po API, nebo počkat, jestli o to zákazníci vůbec požádají?
