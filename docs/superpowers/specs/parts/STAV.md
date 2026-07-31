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

## Poznámka k metodě

Výstup subagenta se nebere jako doklad hotové práce. Každá oprava se ověřuje grepem
ve skutečném souboru. Tímhle způsobem se zachytilo, že části 6 zmizel konec dokumentu
(867 řádků) a že dvě části hlásily opravy, které v souboru nebyly.
