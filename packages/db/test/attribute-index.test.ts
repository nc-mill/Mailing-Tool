import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';
import {
  attributeIndexName,
  dropAttributeIndex,
  ensureAttributeIndex,
  isAttributeIndexValid,
} from '../src/attribute-index';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('indexy nad vlastními poli', () => {
  it('založí platný index a katalog ho potvrdí', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    expect(await ensureAttributeIndex(h.as('mlain_migrator'), 'vek')).toBe(true);
    expect(await isAttributeIndexValid(h.as('mlain_migrator'), 'vek')).toBe(true);
    await dropAttributeIndex(h.as('mlain_migrator'), 'vek');
    expect(await isAttributeIndexValid(h.as('mlain_migrator'), 'vek')).toBe(false);
  });

  it('rozsahový dotaz index použije, GIN nad attributes na to nestačí', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO contacts (workspace_id, email, attributes)
       VALUES ($1, 'attr@example.test', '{"vek":"42"}')`,
      [ws.workspaceA],
    );
    await ensureAttributeIndex(h.as('mlain_migrator'), 'vek');
    const client = await h.as('mlain_migrator').connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM contacts
          WHERE workspace_id = $1 AND (attributes->>'vek') > '30' AND deleted_at IS NULL`,
        [ws.workspaceA],
      );
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(attributeIndexName('vek'));
    } finally {
      await client.query('RESET enable_seqscan').catch(() => undefined);
      client.release();
    }
    await dropAttributeIndex(h.as('mlain_migrator'), 'vek');
  });

  it('klíč mimo povolený tvar se odmítne dřív, než se sáhne na databázi', async () => {
    // Klíč jde do IDENTIFIKÁTORU i do textového literálu, takže bez téhle
    // kontroly by to byla injekce do DDL běžícího pod migrátorem.
    for (const key of ['Vek', 'vek; DROP TABLE contacts', '1vek', '', "a'||''"]) {
      await expect(ensureAttributeIndex(h.as('mlain_migrator'), key)).rejects.toThrow(
        /nemá povolený tvar/,
      );
    }
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_name = 'contacts'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('CONCURRENTLY v transakci selže, proto si utilita bere vlastní spojení', async () => {
    // Pojistka proti tomu, aby někdo utilitu zabalil do withWorkspace.
    const client = await h.as('mlain_migrator').connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(
          `CREATE INDEX CONCURRENTLY idx_contacts__attr_x ON contacts ((attributes->>'x'))`,
        ),
      ).rejects.toThrow(/cannot run inside a transaction block/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
