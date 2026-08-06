# Runbook živého dema

**K čemu to je:** scénář předvedení produktu před publikem, včetně záložních
plánů pro kroky, které závisí na síti.

Revize: 2026-08-06. Příkazy `mlain` ověřené proti `apps/cli/src/registry.ts`,
příkazy `docker compose` proti `docker/compose.yml` (profil `bundled`, bind mount
`./data`).

Scénář z kapitoly 8 hlavní specifikace, devět bodů, upravený tak, aby se dal
odehrát před publikem. Odhad **12 minut aktivní práce**.

## Změna proti hlavní specifikaci

> **Krok 2 se nepředvádí přes ověření domény.** DNS propagace trvá minuty až
> hodiny, takže se ověření v živém demu nedá spolehlivě předvést; specifikace to
> eviduje jako rozpor R2. V demu se místo toho zapne **zkušební režim**, ověří se
> jedna adresa a odešle se na ni. Ověřování domény se ukáže jako obrazovka se
> záznamy a delegačním odkazem, bez čekání na výsledek.

Totéž dělá E2E test zlaté cesty, takže se demo a jediná automatická brána
produktu chovají stejně.

## Příprava před demem

- [ ] **Čerstvá instalace.** Postup je níž a **není to jednořádkový příkaz**. Průvodce prvním spuštěním je první, co publikum uvidí, a na použité instalaci se nespustí.
- [ ] **`mlain backup` hotový.** Když se cokoliv rozsype, obnova ze zálohy je rychlejší než nová instalace. `docker compose exec app mlain backup`.
- [ ] **Ukázková data nahraná v druhém projektu.** Když import CSV selže, přepneš projekt a pokračuješ. Bez téhle přípravy demo končí u kroku 3.
- [ ] **Ověřená adresa připravená.** Zkušební režim odešle jen na ověřené adresy, a ověření trvá jeden e-mail. Udělej ho před demem, ne během.
- [ ] **CSV po ruce.** 50 řádků stačí, 5 000 jen prodlužuje čekání.
- [ ] **Zavřená ostatní okna.** Notifikace během sdílení obrazovky.

### Jak se opravdu vyrobí čerstvá instalace

> **Dřív tady stálo `docker compose down --volumes && docker compose --profile
> bundled up -d`. Čerstvou instalaci to NEUDĚLÁ**, a to tiše: data přežijí a
> průvodce prvním spuštěním se nespustí. Dvě příčiny, obě ověřené v
> `docker/compose.yml`:
>
> 1. `postgres` je za profilem `bundled`, takže ho `down` bez toho profilu ani
>    nezastaví.
> 2. Databáze i `/data` jsou **bind mounty** do `./data`, a `--volumes` maže jen
>    pojmenované svazky, bind mount nikdy. Totéž stálo E2E testy zlaté cesty
>    jeden nález (`compose.e2e.yml` proto přepíná obojí na pojmenované svazky).

```bash
docker compose --profile bundled down --volumes   # profil je nutný
rm -rf ./data                                     # tohle je ten skutečný úklid
docker compose --profile bundled up -d
```

`rm -rf ./data` smaže databázi i nahrané soubory. Před demem je to záměr, jinde
si to dvakrát rozmyslete. Cesta je **relativní ke `compose.yml`**, tedy
`docker/data`, když příkaz pouštíte z kořene repozitáře; smažte přesně ten
adresář, na který ukazuje `volumes:` ve vaší instalaci, ne první `data`, který
uvidíte. Adresář může patřit uživateli z kontejneru, takže může být potřeba
`sudo`.

## Devět bodů

| # | Co ukázat | Kolik času | Záložní plán |
|---|---|---|---|
| 1 | `docker compose --profile bundled up -d`, výpis kontejneru, průvodce vytvoří správce a projekt | 2 min | Instalace už běží, ukaž rovnou Přehled a průvodce popiš. |
| 2 | Připojení odesílání: SMTP, **zkušební režim**, jedna ověřená adresa. Obrazovku DNS záznamů ukaž, ale nečekej na ověření. | 2 min | Když SMTP nenaskočí, ukaž obrazovku s uloženými přístupy a jdi dál; odeslání pak předveď na testovacím e-mailu z připraveného projektu. |
| 3 | Import CSV: rozdělení jména, rod, vokativ, náhled oslovení včetně fallbacku | 2 min | Přepni na druhý projekt s nahranými ukázkovými daty. |
| 4 | AI napíše šablonu | 1,5 min | **Závisí na síti.** Když AI klíč není nebo je odezva pomalá, vyber dodávanou šablonu „Univerzální základní". Řekni nahlas, že AI je nadstavba, ne podmínka. |
| 5 | Doladění myší, testovací odeslání, kontrola v poště | 1,5 min | Testovací e-mail ukaž v poštovní pasti, ne v Gmailu; doručení do veřejné pošty je mimo tvoji kontrolu. |
| 6 | Segment „aktivní za posledních 90 dní", živý počet | 1 min | Segment je připravený v druhém projektu. |
| 7 | Odeslání kampaně, živý průběh | 1 min | Okno na zrušení nastav v projektu na 0 s, jinak stojíš minutu u pruhu, který se nehýbe. |
| 8 | Otevření e-mailu, proklik, časová osa kontaktu | 1 min | **Závisí na síti.** Když se e-mail nedoručí, ukaž časovou osu kontaktu z ukázkových dat, kde otevření i proklik už jsou. |
| 9 | Report kampaně a Přehled | 1 min | Report ukázkové kampaně z druhého projektu má i nedoručení a stížnost, takže je bohatší než čerstvý. |

## Co říct, když se něco zasekne

Produkt je samohostovaný a demo běží na skutečné instalaci, ne na naklikané
prezentaci. To je přednost, ne omluva. Řekni, co se stalo, přepni na záložní
plán a pokračuj; publikum ocení, že vidí běžící software.

## Po demu

```bash
docker compose exec app mlain doctor
docker compose --profile bundled down --volumes
```

`doctor` na konci má smysl: když demo něco rozhodilo, dozvíš se to teď, ne před
příštím publikem.
