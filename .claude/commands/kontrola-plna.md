---
description: Celé CI lokálně, včetně databáze, Go a kontraktních bran
---

Nadmnožina `/kontrola`. Pouštěj před větší dodávkou nebo když je CI červené
a chceš vědět proč dřív, než pushneš.

```sh
pnpm turbo run typecheck test:unit --concurrency=1
pnpm turbo run test:db
node tools/ci/contracts-golden.mjs
node tools/ci/contracts-fixtures-schema.mjs
node tools/ci/contracts-schema.mjs
node tools/ci/openapi-drift.mjs
node tools/ci/i18n-check.mjs
node tools/ci/migration-lint.mjs
node tools/ci/migrations-check.mjs
cd apps/sender && go vet ./... && go test ./... && cd -
```

**Go je mimo turbo i mimo pnpm**, takže ho žádný `pnpm` příkaz nespustí sám.

Když jsi sahal na importy z `@mlain/*` v `apps/web`, přidej ještě:

```sh
cd apps/web && npx next build
```

Typecheck ani jednotkové testy nechytí ani hlubokou podcestu mimo `exports` mapu,
ani barrel domény zatažený do klientské komponenty. Chytí je až build.
