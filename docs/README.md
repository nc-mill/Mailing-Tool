# Dokumentace Mlain Mailer

Rozcestník po `docs/`. Je tu **84 souborů a 13,4 MB**, z toho 84 % objemu jsou
historické plány. Bez tohohle rozdělení není poznat, co je platné zadání a co
záznam o tom, jak se k němu došlo.

**Tři kategorie, v pořadí podle toho, jak často se čtou.**

## 1. Živé dokumenty: podle těchhle se stavÍ

| Soubor | K čemu |
|---|---|
| [`superpowers/STAV-UKOLU.md`](superpowers/STAV-UKOLU.md) | Co se právě dělá, co čeká na zadání, co na rozhodnutí. **Jediný zdroj pravdy o rozdělané práci.** |
| [`superpowers/HOTOVO.md`](superpowers/HOTOVO.md) | Archiv dokončeného i s tím, co se u toho naměřilo. **Přečti dřív, než začneš něco opravovat**, ušetří to druhé objevení téhož. |
| [`superpowers/DESIGN-INTEGRACE.md`](superpowers/DESIGN-INTEGRACE.md) | Železná pravidla pro UI: tokeny, zakázané vzorce, jak se ověřuje vzhled. |
| [`superpowers/DESIGN-ZAKLAD.md`](superpowers/DESIGN-ZAKLAD.md) | Návrhový systém, ze kterého ta pravidla plynou. Velký, čti cíleně. |
| [`superpowers/plans/STAV-IMPLEMENTACE.md`](superpowers/plans/STAV-IMPLEMENTACE.md) | Stav MVP a jak aplikaci rozjet znovu. |
| [`superpowers/plans/ROZHODNUTI-O-VLASTNICTVI.md`](superpowers/plans/ROZHODNUTI-O-VLASTNICTVI.md) | Kdo co vlastní, rozhodnutí R1 až R7. |
| [`PRAMENY.md`](PRAMENY.md) | Co je závazné zadání a co je jen historický pramen. |

Sem patří i **plány z prosince a srpna** v [`superpowers/plans/`](superpowers/plans/)
s datem `2026-08-*`. Ty popisují práci, která se právě dělá nebo se schválila.

## 2. Provozní návody: podle těchhle se jedná v provozu

[`operations/`](operations/) drží runbooky. Jsou psané pro člověka, který řeší
konkrétní situaci, ne pro čtení na pokračování.

| Soubor | Kdy ho otevřít |
|---|---|
| [`operations/backup-restore.md`](operations/backup-restore.md) | Záloha a obnova. |
| [`operations/upgrade.md`](operations/upgrade.md) | Povýšení instalace. |
| [`operations/key-rotation.md`](operations/key-rotation.md) | Výměna šifrovacího klíče. |
| [`operations/partitions-retention.md`](operations/partitions-retention.md) | Oddíly a mazání staré pošty. |
| [`operations/install-external-postgres.md`](operations/install-external-postgres.md) | Instalace proti cizímu Postgresu. |
| [`operations/demo-runbook.md`](operations/demo-runbook.md) | Ukázková data. |
| [`operations/third-party-licenses.md`](operations/third-party-licenses.md) | Licence závislostí. |

**Runbook, který tvrdí, že něco funguje, se ověřuje proti kódu, ne proti sobě.**
Stalo se, že dokument s čerstvou hlavičkou o revizi popisoval frontu, která už
neexistovala a nikdy nedoběhla. Hlavička o revizi není důkaz.

## 3. Archiv: NEČTI a nestav podle toho

Historický záznam o tom, jak vznikalo zadání. **Neplatí jako zadání.** Většina
těchhle souborů má v hlavičce „Historický záznam, ne platné zadání".

| Kde | Co to je | Objem |
|---|---|---|
| [`superpowers/plans/2026-07-31-p*.md`](superpowers/plans/) | Implementační plány P01 až P17 z 31. 7. | 8,5 MB |
| [`superpowers/specs/parts/`](superpowers/specs/parts/) | Rozpad specifikace na části | 2,2 MB |
| [`replan/`](replan/) | Recenze plánů, každý plán z jiného úhlu | 0,5 MB |
| [`superpowers/specs/parts/revize/`](superpowers/specs/parts/revize/) | Recenze specifikace | 0,2 MB |
| [`superpowers/plans/NALEZY-NAPRIC-PLANY.md`](superpowers/plans/NALEZY-NAPRIC-PLANY.md) | Snímek nálezů k 3. 8. | 312 kB |
| [`operations/p16-nalezy.md`](operations/p16-nalezy.md) | Snímek nálezů k 2. 8. | |

**Jednotlivé plány mají až 1,2 MB.** Nikdy je nenačítej celé, spolknou celý
kontext. Hledej v nich grepem a ber jen citace.

## Kudy začít

1. Kořenový [`README.md`](../README.md): rozjezd, porty, role v databázi, provozní příkazy.
2. [`../CLAUDE.md`](../CLAUDE.md): jak se v tomhle repozitáři pracuje, konvence a pasti.
3. [`superpowers/STAV-UKOLU.md`](superpowers/STAV-UKOLU.md): co se právě děje.

## Pravidla vedení

- **Nic se nemaže.** Hotové se přesouvá ze `STAV-UKOLU.md` do `HOTOVO.md`
  s datem a způsobem ověření.
- Nové plány patří do `superpowers/plans/` pod jménem `RRRR-MM-DD-nazev.md`,
  specifikace do `superpowers/specs/`.
- Když dokument přestane platit, dostane do hlavičky větu o tom, že je
  historický, a odkaz na to, co platí místo něj. **Mazat ho není potřeba**,
  ale nechat ho tvářit se jako platný zadání je horší než ho smazat.
