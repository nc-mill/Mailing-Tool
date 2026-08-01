import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Plugin React je nutný kvůli JSX v komponentních testech P05, P06 a P12.
  plugins: [react()],
  // Odchylka od plánu: Vite 8 vyžaduje explicitní zapnutí, jinak alias @/*
  // z tsconfig.json nejde přeložit a testy route handlerů selžou na importu.
  resolve: { tsconfigPaths: true },
  test: {
    // jsdom, ne node: render() z @testing-library/react potřebuje dokument.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Vitest jinak přepíše MODE na "test" a loadConfig() spadne. Zdůvodnění
    // je v packages/config/vitest/node.ts, kde je tentýž řádek.
    env: { MODE: process.env['MODE'] ?? 'web' },
    // Strop souběžnosti, zdůvodnění je v `packages/core/vitest.config.ts`.
    // Tady je navíc jsdom, které je samo o sobě drahé na paměť.
    maxWorkers: 3,
    // src/ MUSÍ být ve vzoru. Testy vedle zdroje jsou tvar, na kterém se shodly
    // P05, P06 i P12; bez tohohle řádku se ani jeden z nich nespustí a série
    // přesto skončí nulou.
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        // next-intl importuje `next/server` bez přípony. Node ESM to mimo
        // Next.js runtime nepřeloží, takže balíček musí projít Vitem.
        inline: [/next-intl/],
      },
    },
  },
});
