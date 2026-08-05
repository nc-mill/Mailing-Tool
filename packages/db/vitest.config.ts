import { defineConfig } from 'vitest/config';

/**
 * DVA PROJEKTY MUSÍ MÍT RŮZNÉ `sequence.groupOrder`, jinak sada NEJDE SPUSTIT.
 *
 * `maxWorkers` je od vitest 4 vlastnost SKUPINY, ne jednotlivého projektu:
 * projekty se stejným `groupOrder` běží současně a musí se na počtu workerů
 * shodnout. Protože `db` má `maxWorkers: 4` a `unit` ho nemá, skončil
 * `pnpm --filter @mlain/db exec vitest run` chybou
 *
 *   Projects "db" and "unit" have different 'maxWorkers' but same 'sequence.groupOrder'
 *
 * a NESPUSTIL ANI JEDEN TEST. Byla to vada, která se maskuje sama: příkaz
 * z dokumentace skončil nenulově s hláškou o konfiguraci, takže se dalo
 * uvěřit, že jde o lokální prostředí, a sada se nespustila vůbec.
 *
 * Pořadí je věcné, ne libovolné. `unit` jde první, protože nepotřebuje
 * kontejner a doběhne v desetinách sekundy; nemá smysl startovat Postgres
 * kvůli tomu, aby vzápětí spadl tvar schématu.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/schema-shape.test.ts', 'test/column-types.test.ts'],
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'db',
          include: ['test/**/*.test.ts'],
          exclude: ['test/schema-shape.test.ts', 'test/column-types.test.ts'],
          environment: 'node',
          sequence: { groupOrder: 1 },
          // Rozhodnutí R31: JEDEN kontejner na celý běh, ne jeden na soubor.
          // globalSetup ho nastartuje, založí role a zmigruje šablonu; každý
          // soubor si pak vytvoří vlastní databázi z té šablony. Bez toho
          // startuje sada přes dvacet kontejnerů a přehraje migrace dvacetkrát.
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // Každý soubor má vlastní databázi, takže si soubory nelezou do dat.
          // Souběh je omezený, ne vypnutý: jeden kontejner unese víc spojení,
          // ale ne dvacet paralelních sad migrací.
          maxWorkers: 4,
        },
      },
    ],
  },
});
