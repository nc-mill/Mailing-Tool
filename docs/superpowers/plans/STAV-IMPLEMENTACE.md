# Stav implementace MVP

Zahájeno: 2026-08-01. Řídí hlavní agent, subagenti nesahají na git.

Cíl: funkční MVP, na které jde kliknout.

## Pravidla provedení

- Pracuje se v hlavním adresáři `/Users/petr/Projects/Mailing_Tool` na větvi `main`.
  Worktree nejsou potřeba, protože všechny paralelní agenty řídí jeden orchestrátor
  a vlastnictví souborů je disjunktní.
- Subagent nesahá na git, nespouští `pnpm install` na kořeni a nepíše mimo svůj adresář.
- Hlášení subagenta není doklad. Ověřuje se stav souborů a zelené testy.
- Nálezy, které přesahují jeden plán, se zapisují do `NALEZY-NAPRIC-PLANY.md`.

## Prostředí

- Node v24.2.0 (pro jsdom je v `$HOME/.n` verze 24.18.1), pnpm 10.30.1, Go 1.26.5.
- Docker běží, `postgres:18-alpine` stažená.
- Vývojová databáze: kontejner `mlain-dev-pg`, port 55432, zmigrovaná.
- Dev server: `apps/web` na portu 3100, konfigurace v `apps/web/.env.local` (mimo git).
- TypeScript je v celém workspace 5.9.3, `moduleResolution` je `Bundler`.

## Vývojový účet pro ruční ověřování

```
e-mail:  dev@mlain.test
heslo:   Vyvojove-Heslo-2026-Mlain
projekt: preflight-projekt (owner)
```

Účet je oddělený schválně. Uživatel `p06-preflight@example.com` patří preflight
testu P06 a jeho heslo se mění podle toho, co ten test očekává, takže se na něj
u ručního zkoušení nedá spolehnout.

Přihlášení funguje koncem na konec přes prohlížeč, ověřeno. Když nejde, zkontroluj
nejdřív rate limiter (hláška „Zkoušíte to příliš často"), je v paměti a vynuluje
se restartem dev serveru.

## Jak aplikaci rozjet znovu

```
docker start mlain-dev-pg
cd apps/web && pnpm exec next dev --port 3100
curl http://localhost:3100/api/health
```

## Ověřený stav

Změřeno v databázi po migracích, souhlasí s plánem na kus:
75 tabulek, 9 partitionovaných, 84 RLS politik, RLS na 67 tabulkách,
7 migrací v ledgeru. Poslední čtyři politiky (`api_key_lookup`, `api_key_touch`,
`ws_api_key_lookup`, `invitation_token_lookup`) doplňují požadavky P04→P03.5
a P04→P03.6, tedy ověření API klíče a přijetí pozvánky bez workspace kontextu.

Aplikace odpovídá: `/api/health` 200, `/api/health/ready` 200 se čtyřmi zelenými
kontrolami proti reálné databázi, `/` přesměruje na `/login`.

| Balíček | Testy |
|---|---|
| `packages/ui` | 358 |
| `packages/core` | 251 |
| `packages/db` | 184 proti reálnému PostgreSQL 18 |
| `packages/contracts` | 235 |
| `packages/emails` | 99 |
| `apps/web` | 89 |
| `tools/ci` | 79 |
| `packages/i18n` | 36 |
| `packages/config` | 24 |
| `apps/worker` | 11 |

## Vlny

| Vlna | Plány | Stav |
|---|---|---|
| 0a | P01 kostra, provoz, CI | hotovo až na závěrečné ověření série |
| 0b | P02 kontrakty | hotovo až na normativní SQL (běží) a Go runnery (čekají na P09) |
| 0b | P05 design systém | komponenty hotové, napojení stylů na aplikaci běží |
| 0c | P03 databáze | hotovo, doplňují se politiky pro `api_keys` a `invitations` |
| 0d | P04 jádro API a identita | úkoly 1 až 22 hotové, 23 až 41 běží, 42 až 46 čekají |
| 1 | P08 šablony | úkoly 1 až 13 hotové, zbytek čeká |
| 1 | P06, P07, P09, P10 | čeká |
| 2 | P11, P12, P13 | čeká |
| 3 | P14, P15, P16 | čeká |

## Co zbývá k prokliknutelnému MVP

1. Napojit design systém na aplikaci, dnes se galerie vykresluje bez stylů.
2. P04 úkoly 42 až 46 (OpenAPI, mount, kompletní série).
3. P06: obrazovky `/setup`, `/login` a nastavení projektu. Bez nich není kam kliknout.
4. P07: kontakty, aspoň seznam a detail.
5. P16: ukázková data, aby v seznamech něco bylo.

## Známé díry

- `test:db` v `packages/core` a `apps/web` neexistuje, CI job `test-db` tam nic nespustí.
- Go runnery kontraktů čekají na produkční balíčky z P09.
- `config.schema.json` neodpovídá tvaru manifestu konfigurace a nic to nevaliduje.
</content>
