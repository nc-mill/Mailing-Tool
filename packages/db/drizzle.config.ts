import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // VÝSLOVNÝ seznam. schema/index.ts ani schema/partitioned.ts tu být NESMÍ,
  // partitionované tabulky se generují ručně v migraci 0003.
  schema: [
    './src/schema/identity.ts',
    './src/schema/platform.ts',
    './src/schema/contacts.ts',
    './src/schema/content.ts',
    './src/schema/campaigns.ts',
    './src/schema/tracking.ts',
  ],
  out: './migrations',
  breakpoints: true,
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env.DATABASE_URL_MIGRATOR ?? 'postgres://mlain_migrator:mlain@localhost:5432/mlain',
  },
});
