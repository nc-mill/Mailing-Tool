import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@mlain/db';
import {
  partitionMaintenanceMetadata,
  recordPartitionMaintenance,
  retentionTargets,
  runPartitionMaintenance,
  type RetentionReport,
} from './partition-retention';

let tmp: string;
/**
 * Nejmenší platné prostředí. Retenční proměnné v něm schválně NEJSOU: většina
 * testů má doložit, že se čtou VÝCHOZÍ hodnoty z konfigurace.
 * `DATABASE_URL_MIGRATOR` je tu kvůli křížové kontrole `MIGRATE_ON_START`.
 */
const baseEnv = (): NodeJS.ProcessEnv => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-retention-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = new Date('2026-08-05T12:00:00.000Z');

describe('retenční cíle', () => {
  it('čte lhůty z konfigurace, ne z konstant v kódu', () => {
    // Tohle je jádro celé práce. `MESSAGE_RETENTION_DAYS` byla mrtvá proměnná:
    // stála v konfiguraci s výchozí hodnotou 90 a v běhovém kódu ji nikdo
    // nečetl. Kdyby se sem někdy vrátilo napevno napsané číslo, provozovatel
    // by proměnnou nastavil, nic by se nezměnilo a nepoznal by to.
    const targets = retentionTargets(NOW, {
      ...baseEnv(),
      MESSAGE_RETENTION_DAYS: '30',
      MESSAGE_EVENT_RETENTION_DAYS: '60',
      TRACKING_RETENTION_MONTHS: '12',
    });
    const byTable = Object.fromEntries(targets.map((t) => [t.table, t]));

    expect(byTable.messages!.cutoff.toISOString()).toBe('2026-07-06T12:00:00.000Z');
    expect(byTable.message_events!.cutoff.toISOString()).toBe('2026-06-06T12:00:00.000Z');
    expect(byTable.web_events!.cutoff.toISOString()).toBe('2025-08-05T12:00:00.000Z');
  });

  it('výchozí lhůta zpráv je 90 dní', () => {
    const messages = retentionTargets(NOW, baseEnv()).find((t) => t.table === 'messages')!;
    expect(messages.window).toBe('90 dní');
    expect(messages.cutoff.toISOString()).toBe('2026-05-07T12:00:00.000Z');
    expect(messages.setting).toBe('MESSAGE_RETENTION_DAYS');
  });

  it('měsíce se odečítají po kalendáři, ne po třiceti dnech', () => {
    // 37 * 30 dní je o skoro měsíc míň než 37 měsíců. Kdyby se lhůta počítala
    // násobkem, smazaly by se webové události, které měly ještě žít.
    const webEvents = retentionTargets(new Date('2026-03-31T00:00:00.000Z'), {
      ...baseEnv(),
      TRACKING_RETENTION_MONTHS: '13',
    }).find((t) => t.table === 'web_events')!;
    expect(webEvents.cutoff.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('uklízí jen tabulky, které mají vlastní konfigurační proměnnou', () => {
    // Tabulka bez proměnné by se mazala podle čísla, které nikde není napsané.
    // `inbound_deliveries` má projektovou retenci po řádcích, zbytek lhůtu nemá.
    //
    // `audit_log` je tu od 7. 8. 2026. Do té doby ho měla uklízet fronta
    // `platform.cleanup_audit_log` mazáním řádků, jenže aplikační role má na
    // auditu odebrané `DELETE`, takže ta úloha padala každou noc a neuklidila
    // nikdy nic. Právo se nevrací, uklízí se zahozením oddílu pod migrátorem.
    expect(retentionTargets(NOW, baseEnv()).map((t) => t.table)).toEqual([
      'messages',
      'message_events',
      'web_events',
      'audit_log',
    ]);
  });

  it('u každého cíle je vidět, která proměnná ho řídí', () => {
    for (const target of retentionTargets(NOW, baseEnv())) {
      expect(target.setting, `${target.table} nemá uvedenou proměnnou`).toMatch(/^[A-Z_]+$/);
      expect(target.window.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Falešné spojení. Zaznamenává SQL v pořadí, v jakém přišlo, a na dotazy
 * katalogu odpovídá tak, aby běh došel do konce bez databáze: žádný oddíl
 * zatím neexistuje, takže se všechny zakládají a žádný se neuklízí.
 */
function recordingClient(): { client: Queryable; log: string[] } {
  const log: string[] = [];
  const query = async (sql: string): Promise<{ rows: Array<{ present: boolean }> }> => {
    log.push(sql.replace(/\s+/g, ' ').trim());
    // `createMonthlyPartitions` se ptá, jestli oddíl už existuje. Bez odpovědi
    // by běh spadl na čtení `rows[0].present`.
    return { rows: sql.includes('to_regclass') ? [{ present: false }] : [] };
  };
  // Přetypování je tu proto, že `query` z `pg` má sedm přetížení včetně
  // streamovacího, a náhrada, která by je splnila všechny, by byla delší než
  // testovaný kód. Úklid volá jen tvar `query(sql)` a `query(sql, params)`.
  return { client: { query } as unknown as Queryable, log };
}

describe('běh údržby oddílů', () => {
  it('zakládá dopředu dřív, než uklízí dozadu', async () => {
    // Pořadí je podstatné a dřív ho držely jen dva časy v cronu patnáct minut
    // od sebe. Chybějící budoucí oddíl zastaví ZÁPISY, protože výchozí oddíl
    // se schválně nezakládá; neuklizená historie nikoho nezastaví. Zakládání
    // proto musí proběhnout i tehdy, když úklid vzápětí spadne.
    const { client, log } = recordingClient();
    await runPartitionMaintenance({ client, now: NOW, env: baseEnv() });

    const firstCreate = log.findIndex((sql) => sql.startsWith('CREATE TABLE'));
    const firstPlan = log.findIndex((sql) => sql.includes('relpartbound'));
    expect(firstCreate, 'nezaložil se ani jeden oddíl dopředu').toBeGreaterThanOrEqual(0);
    expect(firstCreate).toBeLessThan(firstPlan);
  });

  it('v režimu nanečisto nespustí jediný příkaz, který mění stav', async () => {
    const { client, log } = recordingClient();
    const report = await runPartitionMaintenance({
      client,
      now: NOW,
      dryRun: true,
      env: baseEnv(),
    });

    for (const sql of log) {
      expect(sql, `režim nanečisto pustil měnicí příkaz: ${sql}`).not.toMatch(
        /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i,
      );
    }
    expect(report.dryRun).toBe(true);
    expect(report.created).toEqual([]);
    for (const target of report.targets) expect(target.dropped).toEqual([]);
  });

  it('hlásí všechny čtyři cíle i s proměnnou a hranicí', async () => {
    const { client } = recordingClient();
    const report = await runPartitionMaintenance({
      client,
      now: NOW,
      dryRun: true,
      env: baseEnv(),
    });
    expect(report.targets.map((t) => t.table)).toEqual([
      'messages',
      'message_events',
      'web_events',
      'audit_log',
    ]);
    const messages = report.targets[0]!;
    expect(messages.setting).toBe('MESSAGE_RETENTION_DAYS');
    expect(messages.cutoff.toISOString()).toBe('2026-05-07T12:00:00.000Z');
    const audit = report.targets[3]!;
    expect(audit.setting).toBe('AUDIT_RETENTION_MONTHS');
  });
});

describe('záznam o proběhlé údržbě', () => {
  const report = (over: Partial<RetentionReport> = {}): RetentionReport => ({
    dryRun: false,
    created: ['messages_2026_09', 'messages_2026_10'],
    targets: [
      {
        table: 'messages',
        setting: 'MESSAGE_RETENTION_DAYS',
        window: '90 dní',
        cutoff: NOW,
        decisions: [],
        dropped: ['messages_2026_01'],
      },
      {
        table: 'message_events',
        setting: 'MESSAGE_EVENT_RETENTION_DAYS',
        window: '90 dní',
        cutoff: NOW,
        decisions: [],
        dropped: [],
      },
    ],
    ...over,
  });

  it('nese počty, ne jména oddílů', () => {
    // Metadata jsou to jediné, co po běhu zůstane, a musí odpovědět na otázku
    // „běželo to a udělalo to něco", ne vypsat obsah databáze.
    expect(partitionMaintenanceMetadata(report())).toEqual({
      created: 2,
      dropped: 1,
      tables: { messages: 1, message_events: 0 },
    });
  });

  it('běh, který nic nezahodil, se zapíše taky', () => {
    // Nula zahozených oddílů je běžný a správný výsledek. Kdyby se zapisovaly
    // jen běhy, které něco smazaly, vypadala by správně fungující instalace
    // stejně jako instalace, kde úklid vůbec neběží.
    const empty = report({ created: [], targets: [] });
    expect(partitionMaintenanceMetadata(empty)).toEqual({ created: 0, dropped: 0, tables: {} });
  });

  it('zapíše globální systémový záznam s auditní akcí partition.maintained', async () => {
    // Parametr je typovaný výslovně: `vi.fn(async () => ...)` odvodí funkci bez
    // argumentů a `.mock.calls` pak skončí jako pole prázdných n-tic, na kterých
    // typová kontrola spadne při přístupu na index (TS2493).
    const values = vi.fn(async (_row: Record<string, unknown>) => undefined);
    const tx = { insert: vi.fn(() => ({ values })) };
    await recordPartitionMaintenance(tx as never, report());
    const written = values.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      action: 'partition.maintained',
      workspaceId: null,
      actorType: 'system',
      actorLabel: 'mlain partitions',
      targetType: 'partitions',
    });
  });

  /**
   * Past, kvůli které tenhle test existuje: záznam o běhu nanečisto by
   * v `mlain doctor` vypadal jako doklad o proběhlém úklidu, tedy by uklidnil
   * přesně v okamžiku, kdy data leží přes lhůtu.
   */
  it('běh nanečisto do auditu zapsat odmítne', async () => {
    const tx = { insert: vi.fn() };
    await expect(recordPartitionMaintenance(tx as never, report({ dryRun: true }))).rejects.toThrow(
      /nanečisto/,
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
