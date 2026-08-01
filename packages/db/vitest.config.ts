import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/schema-shape.test.ts', 'test/column-types.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['test/**/*.test.ts'],
          exclude: ['test/schema-shape.test.ts', 'test/column-types.test.ts'],
          environment: 'node',
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
