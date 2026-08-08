# Opravy bezpečnostních nálezů z revize 8. 8. 2026

Stav: **HOTOVO 8. 8. 2026.** Všech šest nálezů opraveno a ověřeno hlavním agentem, ne jen nahlášeno.

Zdroj: bezpečnostní revize produktu, šest oblastí souběžně. Každý nález níž jsem
ověřil sám, dva z nich spuštěním, ne čtením.

**Tvrdá podmínka pro všechny opravy: aplikace musí zůstat funkční.** Žádná
oprava nesmí rozbít odesílání, kampaně, formuláře ani veřejné stránky. Každá
změna se dokládá zelenou sadou a u webu i sestavením.

## Seznam nálezů

- [x] **N1 KRITICKÝ. Čtení libovolného souboru přes Liquid.** Sender i TypeScript.
- [x] **N2 VYSOKÝ. Admin se povýší na vlastníka.**
- [x] **N3 VYSOKÝ. API klíč se vydá se scopy, které vydávající nemá.**
- [x] **N4 VYSOKÝ. Uložené XSS přes `javascript:` v odkazu navržené stránky.**
- [x] **N5 STŘEDNÍ, v řetězu vysoký. Bezpečnostní hlavičky se obejdou tečkou v cestě.**
- [x] **N6 STŘEDNÍ. Výpis osiřelých účtů je hlídaný rolí v projektu.**

---

## N1: Čtení libovolného souboru přes Liquid

**Kritický.** Dvě nezávislé implementace, tatáž příčina: obě uzavřely FILTRY
a obě zapomněly na TAGY.

### Go sender

`apps/sender/internal/liquidx/rewrite.go:56` kontroluje jen filtry uvnitř `{{ }}`.
`liquid.NewEngine()` má zapnutý standardní tag `include` nad čtením souborů
a cesta se skládá tak, že `../` funguje bez omezení.

**Ověřeno spuštěním** proti závislosti z `apps/sender/go.mod`:

```
VYSLEDEK: "X SECRET_KEY=topsecret-poc\nDATABASE_URL=postgres://u:p@h/db\n"
```

### TypeScript

`packages/contracts/src/liquid/engine.ts:45` přepisuje všechny vestavěné filtry,
tagy nechává výchozí. **Ověřeno spuštěním:** `{% render 'package.json' %}` vrátilo
2 706 znaků obsahu souboru. Průchod nad kořen liquidjs blokuje, ale všechno pod
pracovním adresářem procesu se přečte.

### Proč se to dostane až tam

Předmět a preheader kampaně jsou jediná uživatelská pole, která **neprocházejí
`validateLiquid`**. Schéma je jen `z.string().max(255)`.

### Cesta útoku

Uživatel s `campaigns:write` nastaví předmět na `{% include "../../../../app/.env" %}`,
publikum na vlastní kontakt, odešle. Obsah souboru dorazí v hlavičce Subject.
Uteče `SECRET_KEY`, kterým se podepisují tokeny všech projektů instalace.
Druhá cesta je zkušební odeslání šablony, které jde mimo předodesílací kontrolu.

### Oprava, dvě vrstvy

1. **Seznam povolených tagů** na obou stranách: `if`, `elsif`, `else`, `endif`,
   `unless`, `endunless`, `for`, `endfor`. Cokoli jiného je chyba, ne tiché
   ignorování. K tomu loader souborů, který čtení odmítá.
2. **Předmět a preheader pustit přes `validateLiquid`** při ukládání.

---

## N2: Admin se povýší na vlastníka

**Vysoký.** `packages/core/src/identity/membership-service.ts:64`.

Nekontroluje se, že udělovaná role není vyšší než role aktéra. Navíc podmínka
`if (input.role !== 'owner')` na řádku 70 znamená, že se **u povýšení na vlastníka
přeskočí i ochrana posledního vlastníka**.

Admin má `members:update_role` a `RoleSchema` připouští `owner`. Povýší se,
pak původního vlastníka odebere, protože ochrana napočítá dva.

**Oprava:** odmítnout roli silnější než role aktéra ve všech třech cestách
(změna role, pozvánka, založení člena). Povýšení na vlastníka nechat výhradně
na převodu vlastnictví, který má reautentizaci heslem.

---

## N3: API klíč se vydá se scopy, které vydávající nemá

**Vysoký.** `packages/core/src/identity/api-key-service.ts:59`.

`assertScopes` ověřuje jen to, že scope existuje v katalogu. Nikdy ho neporovná
s tím, co smí aktér.

`backups:run` je v `OWNER_EXTRA`, tedy jen pro vlastníka. Admin má ale
`api_keys:write`, takže si klíč s tím scope vydá. Zálohy jedou pod migrátorem,
který RLS nepodléhá, takže dump obsahuje **celou instalaci**.

Druhá varianta ruší smysl omezování klíčů: klíč se scope `api_keys:write`
si vyrobí klíč se všemi scopy.

**Oprava:** při vydání i rotaci odmítnout každý scope, který aktér sám nedrží.

---

## N4: Uložené XSS přes `javascript:` v odkazu

**Vysoký.** Tři místa, každé samo o sobě obhajitelné.

`packages/emails/src/document/semantic-structure.ts:258`: jakmile odkaz obsahuje
Liquid a není trackovaný, funkce se **vrátí dřív než ke kontrole schématu**.
U profilu `page` se odkazy nesledují, takže nevznikne ani varování.

`packages/emails/src/emitter/render-page.ts` **nevolá `checkInvariants`**, takže
se neuplatní invariant, který `javascript:` u e-mailů chytá. Liquid navíc běží
až nad hotovým HTML, takže `{{ x }}` zmizí a v atributu zůstane holé schéma.

**Oprava:** kontrolovat schéma i u odkazu s Liquidem, spustit invarianty i při
vykreslení stránky, a neznámé schéma v emitoru degradovat na `#`.

---

## N5: Hlavičky se obejdou tečkou v cestě

**Střední samostatně, vysoký v řetězu s N4.**

Matcher v `apps/web/src/proxy.ts:218` vynechává jakoukoli cestu s tečkou.
Ověřeno spuštěním regexu: `/u/ABC123` projde, `/u/ABC123.x` ne.

`sanitizePublicToken` přitom token na první tečce jen **uřízne**, takže
`/u/TOKEN.x` obslouží tatáž trasa se stejným výsledkem. A `publicHtmlResponse`
si staví odpověď sám a nastavuje jen typ obsahu, zákaz cache a `noindex`.

**Oprava:** nasadit bezpečnostní hlavičky i v `publicHtmlResponse`, jedním
sdíleným pomocníkem s proxy. Zúžení matcheru je slabší varianta, protože
by se muselo trefit do všech budoucích cest.

---

## N6: Výpis osiřelých účtů

**Střední.** `packages/core/src/identity/api/members.routes.ts:245`.

`GET /api/v1/users/orphaned` chrání `members:remove`, což je role v PROJEKTU,
ale vrací e-maily, jména a časy posledního přihlášení účtů z CELÉ INSTALACE.
Doprovodné `DELETE /api/v1/users/{id}` je umí smazat.

**Oprava:** vázat obě cesty na roli instalace, ne projektu.

---

## Rozdělení práce

Čtyři agenti, rozsahy se nepřekrývají ani jedním souborem.

| Agent | Nálezy | Rozsah |
|---|---|---|
| `liquid-tagy` | N1 | `apps/sender/internal/liquidx/**`, `packages/contracts/src/liquid/**`, validace předmětu v `packages/core/src/campaigns/**` |
| `autorizace` | N2, N3, N6 | `packages/core/src/identity/**` |
| `odkazy-stranky` | N4 | `packages/emails/**` |
| `hlavicky` | N5 | `apps/web/src/proxy.ts`, `apps/web/src/features/public/**` |

Každý agent má povinnou kontrolu vrácením a povinné doložení, že aplikace
zůstala funkční.
