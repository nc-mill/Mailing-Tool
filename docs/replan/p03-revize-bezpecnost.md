# Revize P03: bezpečnost, izolace a oprávnění

Datum: 2026-08-01. Model: opus. Plán: `2026-07-31-p03-databaze-schema-rls.md`, hash `05f14f0`.
Verdikt: **NALEZENY PROBLÉMY**. 4 kritické, 11 důležitých, 9 poznámek.

## Opakovaný vzorec, který recenze pojmenovala

> **Ochrana se odvozuje z konstanty v kódu místo ze skutečného stavu databáze.**

Tohle spojuje většinu nálezů:

- `SENDER_BYPASS_TABLES` je pevný seznam, ne dotaz na skutečné granty (K3)
- test RLS vyjímá partitions filtrem `relispartition = false`, takže je nekontroluje (K2)
- testy grantů byly slíbené a nenapsané (D9)
- testovací harness si role zakládá sám, takže atributy produkčních rolí netestuje nikdy (D1)
- ve dvou případech test prochází jen proto, že fixture volí jinou cestu, než jakou jde produkce (D5, K4)

Náprava je u všech stejná: odvozovat kontrolu z katalogu (`pg_policies`, `aclexplode`,
`pg_roles`, `pg_class`), ne z konstanty. Pevný seznam se s realitou rozejde tiše.

Je to zpřesnění pravidla, které v projektu platí od revize specifikací: ke každé ochraně
musí existovat mechanismus, který její porušení zachytí automaticky. Nově k tomu přibývá:
**ten mechanismus se nesmí ptát téhož zdroje, ze kterého ochrana vznikla.**

## Kritické

**K1. Založení projektu je pod vlastními politikami plánu neproveditelné.**
Úkol 24, `createWorkspaceAsUser` běží bez `mlain.workspace_id` a selže dvakrát: `RETURNING`
podléhá SELECT politikám (a `ws_insert_bootstrap` je `FOR INSERT`, takže nepomůže), a vložení
do `memberships` neprojde `WITH CHECK`. Nebezpečné je, že **nejlevnější cesta k zelenému testu
je uvolnit politiku na `memberships`**, tedy přesně ta chyba, které má model bránit.
Oprava: v téže transakci nastavit `set_config('mlain.workspace_id', $id, true)` před `INSERT`.

**K2. Nové partitions nedědí RLS, ale dostávají přímé granty pro `mlain_app`.**
`CREATE TABLE ... PARTITION OF` nekopíruje `relrowsecurity` ani politiky, ale `copyGrantsFromParent`
kopíruje granty. Důsledek: `SELECT * FROM web_events_y2026m08` pod `mlain_app` **bez kontextu
vrátí řádky všech projektů**. Testy to nezachytí, protože filtrují `relispartition = false`
a ptají se jen přes rodiče.
Oprava: granty na partitions vůbec nekopírovat (přístup jde přes rodiče), a z registru RLS
odstranit filtr, který partitions vyjímá.

**K3. Sender má grant na `campaign_render_warnings`, ale ta tabulka nemá `sender_bypass`.**
Agregovaný zápis varování z renderu tedy neprojde nikdy. Test to nezachytí, protože iteruje
pevný seznam, ne skutečné granty. Navíc je grant označený jako součást kontraktu, ale
v kontraktu 4.10.1 ta tabulka není.

**K4. `mlain_maintenance` nesmaže ani jeden řádek `web_events`, takže retence tiše neběží.**
Chybí `SELECT` na sloupce v podmínce (hlasitá chyba), a po jejím „opravení" nastupuje tichá
varianta: role nemá `BYPASSRLS` ani bypass politiku, takže `DELETE` ovlivní **0 řádků
a nevrátí chybu**. Retence osobních údajů se nikdy neprovede a nikdo se to nedozví.
Totéž v menším u `mlain_gdpr` a `consents`; test to maskuje tím, že používá `DELETE` bez `WHERE`.

## Důležité (zkráceně)

| # | Nález |
|---|---|
| D1 | Nikdo netestuje atributy rolí. Kdyby P01 založil `mlain_app` s `BYPASSRLS`, izolace zmizí a testy zůstanou zelené |
| D2 | `unsafeWorkspaceContext` je v kořenovém exportu a jeho jediná ochrana (ESLint pravidlo) není po nikom vyžádaná |
| D3 | Kontext lze uvnitř transakce přenastavit; `BEGIN READ ONLY` `SET LOCAL` nezakazuje, takže injekce v segmentu přečte cizí kontakty |
| D4 | Po neúspěšném `ROLLBACK` se spojení vrací do poolu s nastaveným kontextem předchozího nájemce |
| D5 | Kritérium AK-21c prochází jen proto, že fixture používá aktéra `system` místo `user` |
| D6 | `sender_bypass ON campaigns` nemá `WITH CHECK`, takže sender může kampaň nejen pozastavit, ale i zrušit nebo označit za odeslanou |
| D7 | Dvě šifrované obálky jsou `bytea` proti kontraktu 4.10.4, který výslovně žádá `text` (kvůli dohledatelnosti při rotaci klíčů) |
| D8 | `byteaArray` nemá konverzní funkce a otisky se netestují průchodem přes ovladač, přestože jejich tiché znehodnocení je popsané jako nejhorší scénář |
| D9 | Testy grantů slíbené v úkolu 20 nikde nejsou |
| D10 | `asset_variants` a `asset_references` nemají izolaci ani druhou vrstvu, přitom nesou úložné klíče a referenční graf |
| D11 | `mlain_app` může přepsat nebo smazat `schema_version`, čímž se vypne ochrana proti downgradu |

## Co recenze naopak potvrdila jako v pořádku

- Sloupcový grant **nejde** obejít přes `UPDATE ... FROM` ani přes trigger. Ověřeno proti návrhu.
- Model izolace je dvouvrstvý a ve dvou ohledech lepší než specifikace: registr politik místo
  pevného názvu, a testy senderu pod skutečnou rolí.
