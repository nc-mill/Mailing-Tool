import { getTranslations } from 'next-intl/server';
import { loadConfig } from '@mlain/core/config';
// PODCESTY, ne barrel `@mlain/core/ops`. Barrel reexportuje `restore.ts`,
// `upgrade.ts` a `backup-verify.ts`, a všechny tři vedou na migrační runner.
// Ten si skládá cestu k migracím přes `new URL('../migrations', ...)`, což
// Turbopack neumí vyhodnotit, a **dynamický import to neřeší**: modul zůstane
// v grafu a bundler ho stejně resolvuje. Přes barrel by proto tahle jediná
// stránka shodila CELOU aplikaci na 500.
import { listBackups } from '@mlain/core/ops/backup';
import { readManifest } from '@mlain/core/ops/backup-manifest';
import { BackupList, type BackupListEntry } from '@/features/backups/backup-list';

/**
 * Obrazovka `/w/{slug}/settings/backups` je v mapě aplikace (část 6, 4.1)
 * i v tabulce obrazovek části 1, 5.3, ale v zadání P06 vyjmenovaná není.
 * P16 si ji proto bere, protože zálohy jsou jeho doména.
 *
 * Seznam se čte z disku, ne z databáze: zálohy jsou soubory a jediný zdroj
 * pravdy o nich je adresář. Manifest se čte tolerantně, protože rozpracovaná
 * záloha ho ještě nemá a obrazovka kvůli tomu nesmí spadnout.
 */
/**
 * Stránka se NIKDY nepředrenderovává.
 *
 * Čte konfiguraci a obsah adresáře `/data/backups`, tedy dvě věci, které při
 * sestavení image neexistují. Kdyby ji Next zkusil vyexportovat, spadl by
 * `next build` na `ConfigError … Export encountered an error on <cesta>`,
 * přesně jak se to stalo stránce `/[locale]/(account)/no-workspace`.
 * Dynamický segment `[workspaceSlug]` to dnes drží sám, ale spoléhat na to
 * znamená, že tuhle stránku shodí první `generateStaticParams` nad projekty.
 */
export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  const t = await getTranslations('onboarding.backups');
  const config = loadConfig();
  const entries = await listBackups(config.BACKUP_DIR);
  const data: BackupListEntry[] = await Promise.all(
    entries.map(async (e: { name: string; createdAt: Date }) => {
      const manifest = await readManifest(`${config.BACKUP_DIR}/${e.name}`).catch(() => null);
      return {
        name: e.name,
        createdAt: e.createdAt.toISOString(),
        bytes: manifest?.database.bytes ?? 0,
        contacts: manifest?.row_counts['contacts'] ?? 0,
        verifiedAt: null,
        verifiedOk: null,
      };
    }),
  );

  return (
    <main>
      <h1>{t('title')}</h1>
      <BackupList entries={data} />
    </main>
  );
}
