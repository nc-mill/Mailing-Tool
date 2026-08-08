import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Tytéž limity a týž důvod jako v `apps/web/vitest.config.ts`. Tady zatím
    // nic nepřeteklo, ale nejpomalejší soubor běžel na runneru 7,1 s, takže
    // od výchozích pěti vteřin na test to dělí jediný pomalejší běh.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
