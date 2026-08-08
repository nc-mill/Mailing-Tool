# Bezpečnostní vodítka pro Mlain Mailer

Doplňuje vestavěné kontroly pluginu `security-guidance` o to, co je specifické
pro tenhle projekt. Obecné rady typu „ošetři vstupy" tu schválně nejsou, ty
plugin umí sám.

## Izolace projektů

- Data se filtrují **řádkovou politikou (RLS)**, ne podmínkou `WHERE workspace_id`.
- V `packages/core` se filtruje výhradně přes `wsEq(ctx, tabulka)`, nikdy ručně
  `eq(tabulka.workspaceId, …)`. Hlídá to `src/identity/scope.test.ts`.
- Transakce jen přes obálky z `packages/db/src/repo/tx.ts` (`withWorkspace`,
  `withUser`, `withoutContext`, `withReadOnly`). Nikdy `drizzle(pool).transaction()`.
- Kdo obejde kontext, dostane cizí data bez chybové hlášky.

## Role v databázi

- `mlain_app` schéma nevlastní a **nesmí mazat z `audit_log`**. To odebrané právo
  je vlastnost, ne překážka: záznam, který smí aplikace smazat, není důkaz.
- DDL a zálohy patří migrátorovi (`DATABASE_URL_MIGRATOR`). Záloha pod aplikační
  rolí by RLS vyrobila tiše prázdné tabulky.
- Nové právo se nedává rozšířením role, ale přesunem práce pod tu, která ho už má.

## Veřejné povrchy

- Vše pod `apps/web/src/app/(public)/**` vidí kdokoli s odkazem: bez JavaScriptu,
  `noindex`, a **nikdy jméno projektu** (`workspaces.name`), jen jméno odesílatele.
- Obsah od uživatele se na veřejnou stránku nepouští jako HTML. Odkaz v textu
  souhlasu se rozkládá na segmenty (`forms/consent-markup.ts`) a projde jen
  `http` a `https`, ověřené rozborem adresy, ne hledáním podřetězce.
- Blok syrového HTML je v šablonách druhu `page` zakázaný: stránka běží na naší
  doméně, takže vložený obsah může předstírat cizí značku.
- Token identifikující člověka nepatří do adresy stránky, na kterou se chodí
  přesměrováním: skončil by v historii prohlížeče a v hlavičce odkazující stránky.

## Odchozí spojení

- V `core/src/brand` a `core/src/templates` se ven chodí jen přes `safeFetch`
  (vlastní pravidlo lintu `no-raw-fetch-in-brand`). Je to obrana proti SSRF
  u adres, které zadal uživatel.
- Extrakce značky se nikdy neopakuje (`retryLimit: 0`), opakovaný pokus o SSRF
  není žádoucí.

## Souhlas a výmaz

- Odhlášení a zápis na blokované adresy musí ve stejné transakci zrušit čekající
  poštu. Zachytná úloha `outbox.reconcile` je pojistka, ne hlavní cesta.
- Tvrdé překážky (vymazaný, anonymizovaný, omezené zpracování, blokovaná adresa)
  platí na VŠECHNU poštu. Překážky odvozené ze souhlasu s marketingem jen na
  kampaně: potvrzení dvojího souhlasu jde z definice na nepotvrzený kontakt.
- Výmaz podle článku 17 má jedinou cestu (`gdpr.sever_links`). Druhá cesta by
  znamenala druhý výklad toho, co znamená vymazat kontakt.

## Tajemství

- `SECRET_KEY` a přístupy k databázi se nikdy nedostanou do logu ani do payloadu
  fronty. Payload fronty nesmí obsahovat osobní údaj ani obsah e-mailu, hlídá to
  test registru front.
- `render_data` transakční zprávy nese jednorázové odkazy, proto má vlastní
  retenci (`transactional.purge_render_data`).
