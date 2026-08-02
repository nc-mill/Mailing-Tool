# Mlain Mailer

Nástroj na e-mailový marketing pro české firmy. Jedna instalace, jeden kontejner,
vlastní databáze. Žádná cizí SaaS mezi vámi a vašimi kontakty.

## Co to umí

- **Kontakty a segmenty.** Import z CSV a XLSX, deduplikace, vlastní pole,
  segmenty počítané nad daty, export.
- **Kampaně.** Editor šablon, náhled, testovací odeslání, plánování, průběh
  odesílání v reálném čase.
- **Skloňování.** Oslovení v 5. pádě podle českých pravidel, tedy Petře, Jano,
  Ondřeji. Není to hračka navíc, je to důvod, proč tenhle nástroj vznikl.
- **Doručitelnost.** Kontrola SPF, DKIM a DMARC proti skutečnému DNS, brzda
  při zvýšené chybovosti, práce se seznamem zablokovaných adres.
- **Reporty.** Otevření, prokliky, odhlášení, časová osa jednoho kontaktu.
  U každého procenta je vidět jmenovatel a u odhadů je napsáno, že jsou odhad.
- **Asistent.** Volitelný, s vlastním klíčem k poskytovateli. Pomáhá psát
  texty a vytáhne barvy a písmo z webu značky.

## Předpoklady

| Nástroj                  | Verze                            | Proč                                                                                                                     |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Node.js                  | **24.15.0 nebo novější**, pod 25 | `jsdom@30` níž nejde a `.npmrc` má `engine-strict=true`, takže na starším Node spadne celá instalace, ne jen ten balíček |
| pnpm                     | 10.30.1 nebo novější             | monorepo stojí na workspace protokolu                                                                                    |
| Docker                   | libovolný novější                | databáze pro vývoj i testy                                                                                               |
| Go                       | 1.26 nebo novější                | jen pro odesílací službu v `apps/sender`                                                                                 |
| **klient PostgreSQL 18** | **přesně 18**                    | viz níž, tohle překvapí                                                                                                  |

### Klient PostgreSQL musí být verze 18

`pg_dump` odmítne pracovat proti novějšímu serveru, než je sám:

```
pg_dump: error: server version: 18.4; pg_dump version: 14.18
pg_dump: error: aborting because of server version mismatch
```

Databáze běží na 18, takže starší klient shodí zálohy, obnovu i testy kolem
nich. Na macOS s Homebrew:

```sh
brew install postgresql@18
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
```

Ten `export` si dejte do `.zshrc`, jinak vám po restartu terminálu spadne
osmnáct testů a nebude zjevné proč. `mlain doctor` tuhle neshodu pozná
a pojmenuje ji jako `backup_binary_version_mismatch`.

V produkční image tenhle problém není, `docker/Dockerfile` instaluje
`postgresql18-client`.

## Rozjezd

```sh
pnpm install
cp .env.example apps/web/.env.local   # a vyplňte APP_URL, SECRET_KEY, DATABASE_URL
pnpm --filter @mlain/cli run build
node apps/cli/dist/main.js migrate    # založí schéma
pnpm --filter @mlain/web dev
```

`SECRET_KEY` vygenerujete příkazem `node apps/cli/dist/main.js genkey`.

## Uspořádání

```
apps/
  web        Next.js 16, App Router, obrazovky i veřejné API na Honu
  worker     zpracování front (pg-boss)
  sender     odesílací služba v Go, jediná část mimo TypeScript
  cli        příkaz mlain: migrace, zálohy, obnova, diagnostika
packages/
  core       doménová logika, největší balíček
  db         schéma, migrace, row-level security
  ui         návrhový systém
  i18n       texty v češtině a angličtině
  contracts  sdílené kontrakty a golden fixtures pro obě strany, TS i Go
  emails     šablony systémových e-mailů
docker/      produkční image a entrypoint
docs/        plány, specifikace a registr nálezů
```

## Testy

```sh
pnpm test           # všechno
pnpm typecheck
pnpm lint
```

Databázové testy sdílejí **jeden** kontejner `mlain-test-pg` na celý stroj
a každý soubor si z předmigrované šablony bere vlastní databázi přes
`CREATE DATABASE ... TEMPLATE`. Neplatí to jen pro TypeScript, stejný vzor
používá i strana v Go. Když vám poroste počet kontejnerů, něco je špatně:
pomůže `tools/dev/uklizec-kontejneru.sh`.

Testy v prohlížeči (`pnpm exec playwright test` v `apps/web`) použijí běžící
vývojový server, pokud nějaký běží. Port a hostname si berou z `APP_URL`, takže
si nespustí druhý server nad týmž adresářem `.next`. Dva servery nad jedním
`.next` se poznají špatně: stránky vracejí 200, ale React se nenamountuje.

## Provoz

```sh
mlain migrate              # aplikuje migrace pod rolí migrátora
mlain backup               # záloha databáze i nahraných souborů
mlain backup verify <dir>  # obnoví zálohu do dočasné databáze a spočítá řádky
mlain restore <dir>        # obnova, odmítne neprázdnou databázi
mlain doctor               # diagnostika instalace
mlain upgrade              # záloha, migrace, kontrola připravenosti
mlain reset-password       # když se ztratí přístup k účtu
```

Zálohy se musí dělat pod rolí migrátora. Pod aplikační rolí by row-level
security vyrobila **tiše prázdné** tabulky, takže to `mlain backup` rovnou
odmítne, místo aby vyrobil zálohu, která vypadá v pořádku a není.

## Dokumentace

- `docs/superpowers/plans/` jsou implementační plány jednotlivých částí.
- `docs/superpowers/plans/NALEZY-NAPRIC-PLANY.md` je registr nálezů. Stojí
  za přečtení dřív, než sáhnete na `exports` mapu v `packages/core`, na
  konfiguraci Next.js nebo na testovací harness. Většina těch nálezů má
  společný tvar: nic nespadlo, jen se něco tiše přeskočilo.

## Licence

MIT
