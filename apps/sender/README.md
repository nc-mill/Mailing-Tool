# mlain sender

Odesílací komponenta. Samostatná binárka v Go, spouštěná jako `MODE=sender`.
Konzumuje outbox `messages` z PostgreSQL a odesílá přes Amazon SES v2 nebo SMTP.

## Testy

    go test ./...                        jednotkové, bez databáze
    go test -tags=integration ./...      integrační, vyžaduje PostgreSQL 18

Integrační testy potřebují **jedinou** proměnnou:

    DATABASE_URL_MIGRATOR   připojení, kterým se zakládají role, šablona a klony

Harness je samobootstrapovací: založí role, jednou zmigruje skutečné migrace
z `packages/db/migrations` do předmigrované šablony a připojení senderu si
z téhle jediné proměnné odvodí sám. Testy senderu se nikdy nespouštějí pod
migrátorem, protože by zamaskovaly chybějící politiku `sender_bypass` a claim
by v produkci vracel nula řádků, aniž by cokoliv selhalo. Hlídá to
`TestScenariosRunAsSenderRole`.

**Každý test dostává VLASTNÍ databázi**, klonovanou z předmigrované šablony
přes `CREATE DATABASE ... TEMPLATE` (stejný vzor jako
`packages/core/src/test-support/pg-harness.ts`, rozhodnutí R31 P03). Sdílený
je jen server, ne databáze, takže `go test -tags=integration ./...` je
bezpečné i s výchozí paralelností napříč balíčky, `-p 1` není potřeba a
nepoužívá se. Dřívější verze harnessu dělala `DROP SCHEMA public CASCADE` nad
JEDINOU sdílenou databází při každém testu, což bylo pod souběžnými balíčky
prokazatelně nespolehlivé (`citext does not exist`,
`duplicate key value violates unique constraint "pg_extension_name_index"`);
podrobnosti a důvod jsou v komentáři u `bootstrapLockID` v
`internal/testsupport/pg.go`.

## Naměřené hodnoty

Změřeno 2026-08-02 na Apple M2 Pro (darwin/arm64, Go 1.26.5).

### Izolované kroky (`internal/liquidx`, `internal/mimebuild`)

`go test -run '^$' -bench . -benchmem ./internal/liquidx/ ./internal/mimebuild/`:

    BenchmarkPrepareAndRender100kB-10   6.62 ms/op   8.87 MB/op   32093 allocs/op
    BenchmarkRenderOnly-10              5.78 ms/op   8.52 MB/op   28091 allocs/op
    BenchmarkBuild100kB-10              0.41 ms/op   0.53 MB/op      28 allocs/op

Zdrojový dokument těchhle dvou benchmarků má 1000 řádků, ne 400 jak uvádí zadání
úkolu 43: se 400 řádky vyjde zdroj jen na ~43 kB kvůli diakritice v UTF-8, a
benchmark má cíleně měřit dokument o zhruba 100 kB. Vlastní kontrola uvnitř
benchmarku (`if len(src) < 50_000`) tohle sama odhalí. Jde o nejhorší případ
(1000 substitucí `{{ contact.first_name }}` v jednom dokumentu), viz dál.

### Celá cesta jedné zprávy, tři profily (`internal/app`, O6)

`go test -run '^$' -bench 'BenchmarkFullPipeline' -benchmem -benchtime=200x ./internal/app/`
(pro `WorstCase` `-benchtime=30x`, víc opakování tam kvůli GC tlaku
příležitostně narazí na 50ms limit renderu jednoho volání, viz níž).
Měří přípravu, render HTML, render textové varianty, render předmětu
a sestavení MIME v jednom průchodu, tedy přesně to, co `App.process` udělá
v kroku D2 před voláním dispatcheru.

| Profil      | Substituce | Dokument | ns/op (medián z 5 běhů) | na zprávu    |
| ----------- | ---------- | -------- | ----------------------- | ------------ |
| `Typical`   | 8          | 40 kB    | 437 238                 | **0,44 ms**  |
| `Richer`    | 30         | 80 kB    | 1 012 298               | **1,01 ms**  |
| `WorstCase` | 1000       | 108 kB   | 12 471 354              | **12,47 ms** |

**Rozhodnutí O6: typický i bohatší profil jsou pod prahem 2 ms, náhradní cesta A
z kapitoly 3.7.1 části 4b se nedělá.** Práh platí pro typickou i bohatší
kampaň (5 až 30 polí, 30 až 80 kB): obě běží výrazně pod 2 ms na zprávu.
U extrému (1000 substitucí v jednom dokumentu, syntetický zátěžový případ,
ne kampaň, která v provozu nastane) se práh překračuje zhruba 6násobně, a je
to vědomé: optimalizovat běžnou cestu kvůli případu, který nenastává, by
zaplatilo složitostí kód, který musí být hlavně správný.

Samostatné měření `internal/liquidx` výš vychází vyšší (6,6 ms jen za HTML
render jednoho volání) než podíl na `WorstCase` v tabulce (12,47 ms na CELOU
cestu čtyř renderů plus MIME), protože metodika se liší: izolovaný benchmark
běžel s malým počtem opakování a vyšším tlakem na GC mezi jednotlivými běhy,
zatímco `internal/app` benchmark je zprůměrovaný z 5 opakování po 30
iteracích. Řádová shoda (jednotky milisekund na 1000 substitucí) sedí, přesné
číslo záleží na metodice měření a zatížení stroje v danou chvíli.

## Co tenhle adresář vlastní

Schéma databáze vlastní `packages/db` (P03), kontrakt a runnery golden fixtures
`packages/contracts` a `internal/contracts` (P02), modul a obraz P01. Sender
schéma nikdy nemění a fixtures nikdy neupravuje.
