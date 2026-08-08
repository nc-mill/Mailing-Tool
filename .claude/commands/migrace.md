---
description: Vygenerovat a ověřit migraci databáze
---

```sh
pnpm --filter @mlain/db run db:generate
node tools/ci/migration-lint.mjs
node tools/ci/migrations-check.mjs
```

Než migraci prohlásíš za hotovou, projdi tenhle seznam:

- **Uvnitř `CHECK` ani v jiném literálu nesmí být středník.** Generátor v tom
  místě SQL uřízne a vyrobí nespustitelnou migraci, přičemž snapshot vypadá
  v pořádku. Potřebuješ-li středník v textu, použij `chr(59)`.
- **`mlain_apply_grants()` se kopíruje CELÁ.** Vynechané právo se tiše ztratí
  a projeví se až jako `permission denied` za běhu.
- `now()` mimo `DEFAULT` je zakázané, hlídá to `migration-lint.mjs`.
- Dělené tabulky se píšou ručně, `src/schema/partitioned.ts` do
  `drizzle.config.ts` NEPATŘÍ.
- **Vydaná migrace se už needituje.** Hash ji hlídá; oprava se dělá novou migrací.

Migraci nakonec pusť proti vývojové databázi a ověř výsledek dotazem do katalogu,
ne tím, že runner nevypsal chybu.
