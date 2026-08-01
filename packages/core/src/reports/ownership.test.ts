import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(import.meta.dirname);

/** Tabulky, do kterých tenhle balíček nesmí zapsat ani jeden řádek. */
const READ_ONLY_TABLES = [
  'campaign_stats',
  'campaign_stats_buckets',
  'campaign_link_stats',
  'contact_engagement',
  'message_engagement',
  'message_events',
  'messages',
  'web_events',
  'web_event_months',
  'campaigns',
  'contacts',
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Fixtures smějí zapisovat: simulují to, co v provozu zapíše P10 a P13.
      return entry.name === 'test-support' ? [] : sourceFiles(full);
    }
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.includes('.test.')) return [];
    return [full];
  });
}

describe('vlastnictví zápisu', () => {
  it('balíček reports nikam nezapisuje, jen čte', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const table of READ_ONLY_TABLES) {
        const write = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i');
        if (write.test(source)) offenders.push(`${path.relative(PACKAGE_ROOT, file)} -> ${table}`);
      }
    }
    expect(offenders, 'zápis do cizí tabulky').toEqual([]);
  });

  it('balíček reports neobsluhuje žádnou frontu', () => {
    expect(fs.existsSync(path.join(PACKAGE_ROOT, 'jobs'))).toBe(false);
  });

  it('seznam hlídaných tabulek pokrývá všechny agregace části 5', () => {
    for (const table of ['campaign_stats', 'campaign_stats_buckets', 'campaign_link_stats']) {
      expect(READ_ONLY_TABLES).toContain(table);
    }
  });

  it('na proměnné kontextu Hono a na transakci sahá jediný soubor', () => {
    // Adaptér má smysl jen tehdy, když je opravdu jediný. Jakmile si druhá
    // cesta sáhne na `c.get('auth')` nebo si otevře vlastní transakci,
    // přestane být rozdíl proti P04 opravou na jednom místě.
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_ROOT)) {
      const relative = path.relative(PACKAGE_ROOT, file);
      if (relative === path.join('api', 'context.ts')) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (/c\.get\(\s*'auth'\s*\)/.test(source)) offenders.push(`${relative} -> c.get('auth')`);
      if (/\bwithWorkspace\s*\(/.test(source)) offenders.push(`${relative} -> withWorkspace`);
    }
    expect(offenders, 'kontext Hono nebo transakce mimo api/context.ts').toEqual([]);
  });

  it('doména neimportuje z apps/web ani z kořene @mlain/db', () => {
    // Graf závislostí z 3.11 části 1 opačný směr zakazuje. Kořen @mlain/db
    // navíc `schema` nereexportuje (R37 v P03), takže by import prošel
    // typovou kontrolou a spadl až za běhu.
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const bad of [/from '(\.\.\/)*apps\/web/, /from '@mlain\/db'/]) {
        if (bad.test(source)) offenders.push(path.relative(PACKAGE_ROOT, file));
      }
    }
    expect(offenders, 'zakázaný import').toEqual([]);
  });
});
