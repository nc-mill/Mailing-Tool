# Stav zpracování specifikací

Poslední aktualizace: 2026-07-31, kontrakt zmrazen, běží závěrečné sladění
Orchestrátor: hlavní agent. Subagenti nesahají na git.

## Hotovo

| Fáze | Stav |
|---|---|
| Hlavní specifikace | hotová, revize 2 |
| Rozdělení na části a zadání | hotové |
| Vlna 1: sedm autorů, první průchod | hotová |
| Vlna 2: křížová revize | hotová, 4 soubory v `revize/` |
| Rozhodnutí o změnách kontraktu | hotová, 15 + kategorie B |
| Provedení změn v kontraktu | hotové, kontrakt **ZMRAZEN** |
| Pátý kontrakt (značky pro tracking) | uzavřen z obou stran, části 3 a 4b |

## Běží

| Část | Co zbývá |
|---|---|
| 4a Kampaně | sladění se zmrazeným kontraktem |
| 4b Sender | sladění, plus opakované prověření kontraktu očima Go implementátora |
| 5 Tracking | tři blokující nálezy + přepočet vektorů tokenu + rozhodnutí o SSE |
| 6 UI a UX | obnova ztracených kapitol 9 až 18 |

## Závěrečná kontrola: co musí projít

Commit a push provede orchestrátor **až když projde všech deset bodů**. Zadavatel to schválil předem.

- [ ] Sedm dokumentů má všechny sekce podle šablony (0 až 12)
- [ ] Část 6 má obnovené kapitoly 9 až 18 (slovníček, katalog hlášek, přístupnost, lokalizace, akceptační kritéria, požadavky, rozpory)
- [ ] Část 5 má uzavřené tři blokující nálezy: `contact_engagement`, `processing_restricted`, RLS
- [ ] Část 5 nemá nikde starý tečkový tvar tokenu
- [ ] Testovací vektory tokenu sedí mezi částí 1 a částí 5
- [ ] Formát značek pro tracking sedí mezi částí 3 a částí 4b
- [ ] Části 4a, 4b a 5 hlásí dokončené sladění se zmrazeným kontraktem
- [ ] Nikde není dlouhá pomlčka
- [ ] Nikde není navržená GPL, LGPL ani jiná copyleft závislost
- [ ] Každá část dodala strukturovaný souhrn (rozpory, požadavky, otevřené otázky)

## Průchod s rozhodnutími zadavatele k části 4 (2026-07-31)

Proběhl jeden průchod specifikacemi, který zanesl schválená rozhodnutí zadavatele k části 4.
Uzavřené otázky zůstávají v dokumentech čitelné i s odůvodněním, neškrtaly se beze stopy.

| Co se zaneslo | Kam |
|---|---|
| Práh žlutého varování u míry odrazů 5 % → **4 %**, se stejnou podlahou `GUARD_MIN_SENT` jako automatická pauza | 4a, 3.15.2 a kapitola 0 |
| Uzavřeno O1 až O6, O8 a O10; O11 překlopeno na „čeká na právníka" | 4a, kapitola 12 |
| Suppression: platí verze části 2, protinávrh 4a stažen | 4a kapitola 0 a 12, 2 kapitola 13 |
| Uzavřeno O3 (tvrdé zastavení kampaně v MVP 0 nedělat) a K21 | 4b, kapitoly 10 a 12 |
| Uzavřeno O5 (`fail` pro SES, `retry` pro SMTP), O7 překlopeno na „čeká na právníka" | 1, kapitola 12 |
| Uzavřena otázka 7 (globální retence), otázky 2 a 3 překlopeny na „čeká na právníka" | 5, kapitola 14 |

**Dvě změny zmrazeného kontraktu 4.10.1** (obě schválené zadavatelem):

1. **Úzká výjimka ze zákazu `failed → sent`**, povolená výhradně při `error_code = 'ambiguous_dispatch'` a jen když přechod provádí aplikace při zpracování události od providera. Doplněné testovací scénáře `OB-21` a `OB-22`.
2. **Sloupcový grant na pozastavení kampaně** senderem, `GRANT UPDATE (status, pause_reason) ON campaigns`, se sloupcem `campaigns.pause_reason jsonb` a třemi omezeními (sloupcový grant, jediný přechod `sending → paused`, audit zapisuje aplikace).

**Zrušený strop u kontroly otisků v suppression listu.** Kontrola počítá otisk pod všemi známými pokoleními klíče, bez horního omezení; zrušil se i limit pěti položek u `SECRET_KEY_PREVIOUS`. Se stropem by se nejstarší záznamy přestaly dát ověřit a smazaný člověk by se vrátil prvním dalším importem, aniž by cokoliv selhalo. K tomu přibyl požadavek, aby recovery bundle nesl celý keyring a aby `oe doctor` hlásil chybějící stará pokolení jako kritickou chybu.

## Poznámka k metodě

Výstup subagenta se nebere jako doklad hotové práce. Každá oprava se ověřuje grepem
ve skutečném souboru. Tímhle způsobem se zachytilo, že části 6 zmizel konec dokumentu
(867 řádků) a že dvě části hlásily opravy, které v souboru nebyly.
