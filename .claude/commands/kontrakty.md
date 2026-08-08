---
description: Přegenerovat kontrakty a ověřit, že sedí na kód
---

Pouštěj po každé změně schémat API, fixtures nebo konfigurace.

```sh
pnpm turbo run contracts:generate
node tools/ci/openapi-drift.mjs
node tools/ci/contracts-golden.mjs
node tools/ci/contracts-fixtures-schema.mjs
node tools/ci/contracts-schema.mjs
```

**Co ty brány dokazují a co ne.** `openapi-drift` dokazuje, že commitnutý dokument
sedí na právě vygenerovaný. NEDOKAZUJE, že je v dokumentu každá trasa: kontrola
„každá registrovaná cesta je v dokumentu" žije v `apps/web/test/api/openapi.test.ts`
a přeskakuje cesty se zástupným znakem, cokoli mimo prefix `/api/v1` a porovnává
jen cesty, ne operace. Přidaná metoda k už zdokumentované cestě tedy projde mlčky.

Mimo generovaný kontrakt stojí veřejné trasy pod `(public)/`, měřicí `/e/*`,
`/t/*`, `/a/*` a odchozí webhooky. Popsané jsou ve specifikacích, ne v OpenAPI.
