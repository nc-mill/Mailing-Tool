import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENTIAL_CONTEXTS } from '@mlain/contracts/crypto';
import { startTestPostgres, type TestPostgres } from '../support/db';
import {
  ENCRYPTED_COLUMNS,
  discoverEncryptedColumns,
  unregisteredEncryptedColumns,
} from '../../src/ops/encrypted-columns';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('ENCRYPTED_COLUMNS', () => {
  it('každá položka má tabulku, sloupec, klíč řádku a kontext obálky', () => {
    for (const c of ENCRYPTED_COLUMNS) {
      expect(c.table).toMatch(/^[a-z_]+$/);
      expect(c.column).toMatch(/^[a-z_]+$/);
      expect(c.primaryKey.length).toBeGreaterThan(0);
      expect(CREDENTIAL_CONTEXTS).toContain(c.context);
    }
  });

  it('nemá duplicitní dvojici tabulka a sloupec', () => {
    const keys = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('všechny čtyři sloupce ve schématu opravdu existují a jsou text', async () => {
    // Registr je jediný seznam, podle kterého rotace pracuje. Překlep ve jméně
    // by znamenal, že se ten sloupec NIKDY nepřešifruje, a přišlo by se na to
    // až po odebrání starého klíče, kdy už hodnotu nikdo nedešifruje.
    //
    // Typ hlídá i P03 vlastním testem: kontrakt 4.10.4 je textový a dva
    // sloupce v bytea by rotaci nutily pracovat na každém jinak.
    for (const c of ENCRYPTED_COLUMNS) {
      const rows = await pg.sql<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [c.table, c.column],
      );
      expect(rows, `${c.table}.${c.column} ve schématu není`).toHaveLength(1);
      expect(rows[0]!.data_type, `${c.table}.${c.column}`).toBe('text');
    }
  });

  it('každá tabulka v registru má workspace_id, protože obálka je na projekt vázaná', async () => {
    // AAD obálky nese workspace_id (kontrakt P02, 4.10.4). Bez něj dešifrování
    // selže, takže rotace musí u každého řádku znát jeho projekt.
    for (const c of ENCRYPTED_COLUMNS) {
      const rows = await pg.sql(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'workspace_id'`,
        [c.table],
      );
      expect(rows, `${c.table} nemá workspace_id`).toHaveLength(1);
    }
  });
});

describe('hlídač registru', () => {
  it('všechny sloupce s příponou _encrypted ve schématu jsou v registru', async () => {
    const missing = await unregisteredEncryptedColumns(pg.ownerUrl);
    expect(missing).toEqual([]);
  });

  it('nový neregistrovaný sloupec test odhalí', async () => {
    await pg.sql(`CREATE TABLE pokus_tajemstvi (id uuid primary key, cosi_encrypted bytea)`);
    const missing = await unregisteredEncryptedColumns(pg.ownerUrl);
    expect(missing).toContain('pokus_tajemstvi.cosi_encrypted');
    await pg.sql('DROP TABLE pokus_tajemstvi');
  });

  it('discoverEncryptedColumns vrací jen sloupce se známou příponou', async () => {
    const found = await discoverEncryptedColumns(pg.ownerUrl);
    expect(found.every((c) => c.endsWith('_encrypted'))).toBe(true);
  });
});
