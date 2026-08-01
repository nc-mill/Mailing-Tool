// packages/db/test/migrations-check.test.ts
//
// Tři scénáře blokujícího CI jobu `migrations-check`. Skript `test:migrations`
// zapisuje package.json v úkolu 1, tenhle soubor ho jen naplňuje obsahem.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { startHarness } from './helpers/container';
import { runMigrations } from '../src/migrate';
import { seedTwoWorkspaces } from './helpers/fixtures';
import { ensureUpcomingPartitions } from '../src/partitions';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

type Journal = { entries: Array<{ idx: number; tag: string }> };
function journal(): Journal {
  return JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
}

describe('scénář 1: prázdná databáze plus všechny migrace, žádný drift', () => {
  it('drizzle-kit check nehlásí konflikt ani drift', async () => {
    // drizzle-kit check porovnává snapshoty v meta/ mezi sebou. Když projde,
    // znamená to, že žádné dvě migrace nepopisují nekompatibilní stav.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout, stderr } = await run('pnpm', ['exec', 'drizzle-kit', 'check'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    expect(`${stdout}${stderr}`).not.toMatch(/conflict|drift|error/i);
  }, 120_000);

  it('opakovaný drizzle-kit generate nevygeneruje žádnou novou migraci', async () => {
    // Generuje se do DOČASNÉHO adresáře, ne do repozitáře. Původní varianta
    // psala rovnou do packages/db/migrations, takže test mutoval pracovní strom
    // a poslední úkol plánu, který kontroluje jeho čistotu, by hlásil porušení
    // vlastnictví souborů kvůli vlastnímu testu.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { cpSync, mkdtempSync, readdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const run = promisify(execFile);

    const pkg = fileURLToPath(new URL('..', import.meta.url));
    const out = mkdtempSync(join(tmpdir(), 'mlain-drift-'));
    // Existující migrace i snapshoty musí být na místě, jinak by drizzle-kit
    // vygeneroval celé schéma znovu a test by hlásil drift vždy.
    cpSync(MIGRATIONS, out, { recursive: true });

    const config = join(out, 'drizzle.drift.config.ts');
    writeFileSync(
      config,
      [
        `import base from ${JSON.stringify(join(pkg, 'drizzle.config.ts'))};`,
        `export default { ...base, out: ${JSON.stringify(out)} };`,
      ].join('\n'),
    );

    const before = readdirSync(out).filter((f) => f.endsWith('.sql')).length;
    await run(
      'pnpm',
      ['exec', 'drizzle-kit', 'generate', `--config=${config}`, '--name=drift_probe'],
      {
        cwd: pkg,
      },
    );
    const after = readdirSync(out).filter((f) => f.endsWith('.sql')).length;

    expect(after, 'drizzle-kit vygeneroval migraci, Drizzle schéma se rozešlo se snapshotem').toBe(
      before,
    );
  }, 120_000);
});

describe('scénář 2: databáze z předchozího vydání plus nové migrace', () => {
  it('aplikace poslední migrace nad databází zmigrovanou o krok zpět projde', async () => {
    const h = await startHarness({ migrate: false });
    try {
      const entries = journal().entries;
      const url = h.urlFor('mlain_migrator');

      // Krok zpět: dočasný adresář s journalem bez poslední migrace.
      const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const dir = mkdtempSync(join(tmpdir(), 'mlain-prev-'));
      mkdirSync(join(dir, 'meta'), { recursive: true });
      const previous = entries.slice(0, -1);
      writeFileSync(
        join(dir, 'meta', '_journal.json'),
        JSON.stringify({ version: '7', dialect: 'postgresql', entries: previous }, null, 2),
      );
      for (const entry of previous) {
        copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
      }

      await runMigrations({ url, migrationsFolder: dir, ensurePartitions: false });
      // A teď plná sada, tedy jen ta poslední migrace navíc.
      await expect(runMigrations({ url })).resolves.toBeUndefined();

      const { rows } = await h
        .as('mlain_migrator')
        .query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
      expect(rows[0]!.n).toBe(entries.length);
    } finally {
      await h.stop();
    }
  }, 180_000);
});

describe('scénář 3: migrace nad databází s reálnými daty', () => {
  it('10 000 kontaktů a 10 000 zpráv projde opakovaným během migrací', async () => {
    const h = await startHarness();
    try {
      // Oddíl aktuálního měsíce zakládá test, ne runner: šablona se migruje
      // s ensurePartitions: false, takže by zápis do messages skončil chybou
      // "no partition of relation found", ne na tom, co scénář zkoumá.
      await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      await h.as('mlain_migrator').query(
        `INSERT INTO contacts (workspace_id, email, locale)
         SELECT $1, 'seed-' || g || '@example.test', 'cs'
           FROM generate_series(1, 10000) AS g`,
        [ws.workspaceA],
      );

      const campaignId = uuidv7();
      // Aktuální měsíc: oddíl už existuje, takže se test neváže na pevné datum
      // a nezačne padat, až aktuální měsíc přeteče.
      const { rows: nowRow } = await h
        .as('mlain_migrator')
        .query<{ t: string }>(`SELECT date_trunc('second', now())::text AS t`);
      const builtAt = nowRow[0]!.t;
      await h.as('mlain_migrator').query(
        `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
         VALUES ($1, $2, 'Zátěž', 'sending', $3)`,
        [campaignId, ws.workspaceA, builtAt],
      );
      await h.as('mlain_migrator').query(
        `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at)
         SELECT $1, $2, c.id, c.email::text, $3
           FROM contacts c WHERE c.workspace_id = $1 LIMIT 10000`,
        [ws.workspaceA, campaignId, builtAt],
      );

      // Opakovaný běh nad naplněnou databází musí projít bez chyby.
      await expect(runMigrations({ url: h.urlFor('mlain_migrator') })).resolves.toBeUndefined();

      const { rows } = await h
        .as('mlain_migrator')
        .query<{ n: number }>('SELECT count(*)::int AS n FROM messages');
      expect(rows[0]!.n).toBe(10000);
    } finally {
      await h.stop();
    }
  }, 240_000);

  it('invariant I1 drží: všech 10 000 zpráv má identické created_at s nulovými setinami', async () => {
    const h = await startHarness();
    try {
      await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      const campaignId = uuidv7();
      await h.as('mlain_migrator').query(
        `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
           VALUES ($1, $2, 'I1', 'queueing', date_trunc('second', now()))`,
        [campaignId, ws.workspaceA],
      );
      // Dvě dávky po 500, jak předepisuje scénář OB-13.
      for (let batch = 0; batch < 2; batch += 1) {
        await h.as('mlain_migrator').query(
          `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at)
             SELECT $1, $2, gen_random_uuid(), 'b' || $3 || '-' || g || '@example.test',
                    (SELECT audience_built_at FROM campaigns WHERE id = $2)
               FROM generate_series(1, 500) AS g`,
          [ws.workspaceA, campaignId, batch],
        );
      }
      const { rows } = await h.as('mlain_migrator').query<{
        distinct_times: number;
        subsecond: number;
      }>(
        `SELECT count(DISTINCT created_at)::int AS distinct_times,
                  count(*) FILTER (WHERE date_trunc('second', created_at) <> created_at)::int
                    AS subsecond
             FROM messages WHERE campaign_id = $1`,
        [campaignId],
      );
      expect(rows[0]!.distinct_times).toBe(1);
      expect(rows[0]!.subsecond).toBe(0);
    } finally {
      await h.stop();
    }
  }, 180_000);
});
