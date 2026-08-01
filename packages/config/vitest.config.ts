import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // src/ ve vzoru je jednotné pravidlo napříč celým monorepem: testovací
    // soubor mimo vzor se nespustí a série přesto skončí nulou.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    reporters: ['default'],
  },
});
