import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CAMPAIGN_ID,
  contractSqlDir,
  type ContractDb,
  runClaim,
  seedMessages,
  seedWorkspaceAndCampaign,
  startContractDb,
  stopContractDb,
  truncateAll,
} from './helpers';

let db: ContractDb;

async function contractSql(file: string): Promise<string> {
  const raw = await readFile(path.join(contractSqlDir, file), 'utf8');
  return raw
    .replace(/^--.*$/gm, '')
    .trim()
    .replace(/;\s*$/, '');
}

/**
 * Plán píše `const [claimed] = await runClaim(...)`. Preset tsconfig má
 * `noUncheckedIndexedAccess: true`, takže prvek pole nese `| undefined`
 * a každý přístup k němu neprojde typovou kontrolou. Prázdný claim je navíc
 * chyba scénáře, ne případ k tichému přeskočení, proto tvrdá výjimka.
 */
function onlyRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('claim nevrátil ani jeden řádek');
  return row;
}

beforeAll(async () => {
  db = await startContractDb();
}, 180_000);
afterAll(async () => stopContractDb(db));
beforeEach(async () => truncateAll(db));

describe('OB-19 a OB-20: stráž claimed_by v D1 a D3', () => {
  it('OB-19: D1 senderu A ovlivní 0 řádků, když claim mezitím přebral B', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const claimed = onlyRow(
      await runClaim(db.sender, {
        claimedBy: 'sender-a',
        batchSize: 1,
        ttlSeconds: 300,
        campaignId: CAMPAIGN_ID,
      }),
    );

    // reaper uvolní claim (simulace vypršení) a claimne ho sender B
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '1 second'`);
    await db.sender.query(await contractSql('04-reaper-stuck.sql'));
    await runClaim(db.app, {
      claimedBy: 'sender-b',
      batchSize: 1,
      ttlSeconds: 300,
      campaignId: CAMPAIGN_ID,
    });

    const d1 = await db.sender.query(await contractSql('07-dispatch-begin.sql'), [
      claimed.id,
      claimed.created_at,
      'sender-a',
    ]);
    expect(d1.rowCount).toBe(0);

    const { rows } = await db.app.query('SELECT claimed_by, attempts FROM messages');
    expect(rows[0].claimed_by).toBe('sender-b');
    expect(rows[0].attempts).toBe(0);
  });

  it('OB-20: D3 senderu A ovlivní 0 řádků a nepřepíše výsledek nového vlastníka', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const claimed = onlyRow(
      await runClaim(db.sender, {
        claimedBy: 'sender-a',
        batchSize: 1,
        ttlSeconds: 300,
        campaignId: CAMPAIGN_ID,
      }),
    );
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '1 second'`);
    await db.sender.query(await contractSql('04-reaper-stuck.sql'));
    await runClaim(db.app, {
      claimedBy: 'sender-b',
      batchSize: 1,
      ttlSeconds: 300,
      campaignId: CAMPAIGN_ID,
    });

    const okB = await db.app.query(await contractSql('08-dispatch-result.sql'), [
      claimed.id,
      claimed.created_at,
      'sender-b',
      'provider-id-B',
    ]);
    expect(okB.rowCount).toBe(1);

    const lateA = await db.sender.query(await contractSql('08-dispatch-result.sql'), [
      claimed.id,
      claimed.created_at,
      'sender-a',
      'provider-id-A',
    ]);
    expect(lateA.rowCount).toBe(0);

    const { rows } = await db.app.query('SELECT status, provider_message_id FROM messages');
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_message_id).toBe('provider-id-B');
  });
});

describe('OB-02, OB-03 a OB-04: reaper', () => {
  it('OB-02: expirovaný claim bez rozpracovaného odeslání jde zpět na pending a attempts se nemění', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 5);
    await runClaim(db.sender, {
      claimedBy: 'sender-a',
      batchSize: 5,
      ttlSeconds: 300,
      campaignId: CAMPAIGN_ID,
    });
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '1 second'`);

    const reaped = await db.sender.query(await contractSql('04-reaper-stuck.sql'));
    expect(reaped.rowCount).toBe(5);

    const { rows } = await db.app.query(
      `SELECT status, attempts, claimed_by, claim_expires_at FROM messages`,
    );
    for (const row of rows) {
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(0);
      expect(row.claimed_by).toBeNull();
      expect(row.claim_expires_at).toBeNull();
    }
  });

  it('OB-03: první nejednoznačné odeslání s politikou retry končí na pending', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const claimed = onlyRow(
      await runClaim(db.sender, {
        claimedBy: 'sender-a',
        batchSize: 1,
        ttlSeconds: 300,
        campaignId: CAMPAIGN_ID,
      }),
    );
    await db.sender.query(await contractSql('07-dispatch-begin.sql'), [
      claimed.id,
      claimed.created_at,
      'sender-a',
    ]);
    // claim vypršel víc než o jeden TTL, tedy o rezervu reaperu B
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '400 seconds'`);

    const result = await db.sender.query(await contractSql('05-reaper-ambiguous.sql'), [
      'retry',
      300,
    ]);
    expect(result.rowCount).toBe(1);

    const { rows } = await db.app.query(
      'SELECT status, error_code, attempts, ambiguous_count FROM messages',
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].error_code).toBe('ambiguous_dispatch');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].ambiguous_count).toBe(1);
  });

  it('OB-04: druhý výskyt končí na failed bez ohledu na politiku', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const claimed = onlyRow(
      await runClaim(db.sender, {
        claimedBy: 'sender-a',
        batchSize: 1,
        ttlSeconds: 300,
        campaignId: CAMPAIGN_ID,
      }),
    );
    await db.sender.query(await contractSql('07-dispatch-begin.sql'), [
      claimed.id,
      claimed.created_at,
      'sender-a',
    ]);
    await db.app.query(
      `UPDATE messages SET claim_expires_at = now() - interval '400 seconds', ambiguous_count = 1`,
    );

    await db.sender.query(await contractSql('05-reaper-ambiguous.sql'), ['retry', 300]);

    const { rows } = await db.app.query('SELECT status, ambiguous_count FROM messages');
    expect(rows[0].status).toBe('failed');
    expect(rows[0].ambiguous_count).toBe(2);
  });

  it('znaménko u rezervy reaperu B je mínus: právě odesílaná zpráva se nezasáhne', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const claimed = onlyRow(
      await runClaim(db.sender, {
        claimedBy: 'sender-a',
        batchSize: 1,
        ttlSeconds: 300,
        campaignId: CAMPAIGN_ID,
      }),
    );
    await db.sender.query(await contractSql('07-dispatch-begin.sql'), [
      claimed.id,
      claimed.created_at,
      'sender-a',
    ]);

    // claim vydaný před vteřinou, tedy platný. S plusem místo mínusu by ho
    // reaper zasáhl a mechanismus proti duplicitám by duplicity sám vyráběl.
    const result = await db.sender.query(await contractSql('05-reaper-ambiguous.sql'), [
      'retry',
      300,
    ]);
    expect(result.rowCount).toBe(0);
  });
});

describe('OB-14: zrušení kampaně', () => {
  it('pending jde na skipped, žádný na failed, claimed zůstává', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 550);
    await runClaim(db.sender, {
      claimedBy: 'sender-a',
      batchSize: 50,
      ttlSeconds: 300,
      campaignId: CAMPAIGN_ID,
    });

    await db.app.query(
      `UPDATE messages SET status = 'skipped', error_code = 'campaign_cancelled', updated_at = now()
       WHERE campaign_id = $1 AND status = 'pending'`,
      [CAMPAIGN_ID],
    );

    const { rows } = await db.app.query(
      `SELECT status, count(*)::int AS n FROM messages GROUP BY status ORDER BY status`,
    );
    expect(rows).toEqual([
      { status: 'claimed', n: 50 },
      { status: 'skipped', n: 500 },
    ]);
  });
});

describe('OB-21 a OB-22: výjimka failed -> sent', () => {
  it('OB-21: přechod uspěje u ambiguous_dispatch a doplní provider_message_id a sent_at', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1, {});
    await db.app.query(`UPDATE messages SET status = 'failed', error_code = 'ambiguous_dispatch'`);

    const result = await db.app.query(
      `UPDATE messages SET status = 'sent', provider_message_id = $1, sent_at = now(), updated_at = now()
       WHERE status = 'failed' AND error_code = 'ambiguous_dispatch'`,
      ['late-provider-id'],
    );
    expect(result.rowCount).toBe(1);

    const { rows } = await db.app.query(
      'SELECT status, provider_message_id, sent_at FROM messages',
    );
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_message_id).toBe('late-provider-id');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it.each(['render_failed', 'provider_rejected', null])(
    'OB-22: tentýž přechod s error_code %s neovlivní ani řádek',
    async (code) => {
      await seedWorkspaceAndCampaign(db);
      await seedMessages(db, 1, {});
      await db.app.query(`UPDATE messages SET status = 'failed', error_code = $1`, [code]);

      const result = await db.app.query(
        `UPDATE messages SET status = 'sent', provider_message_id = $1, sent_at = now()
         WHERE status = 'failed' AND error_code = 'ambiguous_dispatch'`,
        ['x'],
      );
      expect(result.rowCount).toBe(0);

      const { rows } = await db.app.query('SELECT status FROM messages');
      expect(rows[0].status).toBe('failed');
    },
  );
});

describe('registr scénářů', () => {
  it('každý scénář s runnerem contracts má test v tomhle balíčku', async () => {
    const testRoot = path.join(contractSqlDir, '..', '..', '..', 'test');
    const registry = JSON.parse(
      await readFile(path.join(contractSqlDir, '..', 'scenarios.json'), 'utf8'),
    ) as { scenarios: Array<{ id: string; runner: string }> };

    // Prochází se CELÝ strom test/, ne ručně vypsaný seznam souborů. Dřívější
    // znění četlo čtyři soubory a OB-11 leželo v pátém (test/message-id.*),
    // takže kontrola sama padala; a OB-07 mělo ručně zapsanou výjimku, která by
    // přežila i to, že jeho test zmizí. Obojí je pryč: skenuje se všechno
    // a výjimka není žádná.
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const out = await Promise.all(
        entries.map(async (entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          return entry.name.endsWith('.test.ts') ? [full] : [];
        }),
      );
      return out.flat();
    };

    const files = await walk(testRoot);
    const joined = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');

    const ours = registry.scenarios.filter((s) => s.runner === 'contracts').map((s) => s.id);
    const missing = ours.filter((id) => !joined.includes(id));
    expect(missing, `scénáře bez testu: ${missing.join(', ')}`).toEqual([]);
    expect(ours).toHaveLength(21);
    expect(registry.scenarios).toHaveLength(23);
    expect(registry.scenarios.filter((s) => s.runner === 'sender').map((s) => s.id)).toEqual([
      'OB-10',
    ]);
    expect(registry.scenarios.filter((s) => s.runner === 'campaigns').map((s) => s.id)).toEqual([
      'OB-15',
    ]);
  });
});
