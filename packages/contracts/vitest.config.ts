import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/*.test.ts'],
          exclude: ['test/*.golden.test.ts'],
        },
      },
      {
        test: {
          name: 'golden',
          include: ['test/*.golden.test.ts'],
        },
      },
      {
        test: {
          name: 'db-ob00',
          include: ['test/db/00-ob00.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'db-rest',
          include: ['test/db/1*.test.ts', 'test/db/2*.test.ts'],
          testTimeout: 300_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
