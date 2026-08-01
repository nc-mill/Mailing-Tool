import path from 'node:path';
import { withMlainIntl } from '@mlain/i18n/next-plugin';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Kořen workspace se v monorepu MUSÍ nastavit výslovně. Bez toho si ho
  // Turbopack odvozuje a při prvním přibylém adresáři pod src/app si odvodí
  // `apps/web/src/app`, odkud `next/package.json` nedohledá. Neprojeví se to
  // chybou v kódu, ale panikou celého Turbopacku a pádem dev serveru.
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // Balíčky @mlain/* jsou zdrojové, bez vlastního buildu.
  transpilePackages: ['@mlain/ui', '@mlain/i18n'],
  experimental: {
    // Ikony se importují jmenovitě, aby se nikdy nezabalil celý balík (14.3).
    optimizePackageImports: ['lucide-react'],
  },
  // Graceful shutdown registruje src/instrumentation.ts. Žádný přepínač
  // nepotřebuje: instrumentation.ts je od Next 15 stabilní a načítá se sám.
};

// Typová anotace je nutná: `withMlainIntl` vrací typ odvozený z vnořené
// instalace `next` v `next-intl/plugin`, kterou TypeScript nedokáže
// pojmenovat napříč pnpm store (TS2742). Konfigurace samotná se tím nemění.
const finalConfig: NextConfig = withMlainIntl(config);

export default finalConfig;
