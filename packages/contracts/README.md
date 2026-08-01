# @mlain/contracts

Pět zmrazených kontraktů mezi TypeScriptem a Go. Zdrojem pravdy je
`docs/superpowers/specs/parts/01-platforma.md`, kapitola 4.10, a pro kontrakt 5
`docs/superpowers/specs/parts/03-obsah.md`, kapitola 4.1.

| #   | Kontrakt              | Kód                                                            | Fixtures                                                          |
| --- | --------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Outbox protokol       | `src/outbox.ts`, `src/outbox-errors.ts`, `src/pause-reason.ts` | `fixtures/outbox/`                                                |
| 2   | Liquid subset         | `src/liquid/`                                                  | `fixtures/liquid/` (55)                                           |
| 3   | Trackovací tokeny     | `src/token.ts`, `src/message-id.ts`                            | `fixtures/token/vectors.json`, `fixtures/message-id/vectors.json` |
| 4   | Šifrování credentials | `src/crypto.ts`, `src/keyring.ts`                              | `fixtures/crypto/vectors.json`                                    |
| 5   | Značky pro tracking   | `src/markers.ts`, `src/compiled.ts`                            | `fixtures/markers/`, `fixtures/compiled/`                         |

Go stranu **implementace** vlastní P09 v produkčních balíčcích. Tenhle balíček dodává na Go straně jen `apps/sender/internal/contracts`, což je testovací podpora: čtení fixtures, otisk, zápis reportu a runnery, kterým se produkční funkce předávají jako parametr.

## Pravidla

Balíček **neimportuje z monorepa nic.** Je to kořen grafu závislostí a zároveň
jediné místo, které čte i Go, přes symlink `apps/sender/testdata`.

Fixture se nikdy neopravuje tak, aby prošla. Opravuje se implementace. Změna
očekávané hodnoty vyžaduje commit message začínající `contract:` a review
vlastníků obou stran, což hlídá `CODEOWNERS`.

## Příkazy, které pouští CI

| Job                         | Příkaz                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts-golden`          | `pnpm --filter @mlain/contracts test:golden`, `go test ./... -run TestGolden`, `pnpm --filter @mlain/contracts test:parity`                  |
| `contracts-fixtures-schema` | `pnpm --filter @mlain/contracts test:fixtures-schema`                                                                                        |
| `contracts-schema`          | `node tools/ci/contracts-schema.mjs` nad `schema/columns.json` a `pnpm --filter @mlain/contracts test:schema` proti Postgresu ze `services:` |
| `test-go-integration`       | `go test -tags=integration ./...` s `DATABASE_URL_MIGRATOR`                                                                                  |

`test:parity` je zelený až od vlny 1, kdy P09 dodá Go implementaci a runnery se mají o co opřít. Do té doby hlásí chybějící Go reporty, což je správně: parita nad jednou stranou není parita.

`contracts-golden` běží **bez databáze**. Kontrola kontraktních sloupců proti
migracím patří do `contracts-schema`, který databázi má.

## Generované soubory

`fixtures/token/vectors.json`, `fixtures/crypto/vectors.json`,
`fixtures/message-id/vectors.json`, `fixtures/liquid/LQ-403.json`,
`schema/columns.json` a `config.json` vyrábí
`pnpm --filter @mlain/contracts contracts:generate`.
Needitují se ručně. `openapi.json` generuje P04 a tenhle balíček ho jen hostí.
