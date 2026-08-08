---
description: Rychlá brána před commitem: lint, typecheck, jednotkové testy
---

Spusť v kořeni repozitáře, v tomhle pořadí, a **zastav se na první chybě**:

```sh
pnpm exec oxlint .
pnpm exec eslint .
pnpm exec prettier --check .
pnpm turbo run typecheck
pnpm turbo run test:unit --concurrency=1
```

`--concurrency=1` u testů není opatrnost navíc: při souběhu dvou balíčků občas
spadne ÚKLID testů na `57P01`, tedy na spojení přeťatém vypnutím kontejneru,
přestože všechny testy prošly.

**`pnpm test` v tomhle repozitáři NEEXISTUJE**, i když ho README zmiňuje.

Když sada spadne, nehlaš „mělo by to fungovat". Dohledej příčinu, oprav ji
a pusť to znovu. Výsledek pak popiš věcně: co prošlo, co padá, co jsi přeskočil.
