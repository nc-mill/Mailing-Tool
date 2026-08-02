import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { resetPassword, UserNotFoundError } from '../../src/ops/reset-password';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 0, ownerEmail: 'jana@firma.cz' });
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('resetPassword', () => {
  it('nastaví nové heslo a vrátí ho, když se nezadalo', async () => {
    const r = await resetPassword({
      databaseUrl: pg.ownerUrl,
      email: 'jana@firma.cz',
      password: null,
    });
    expect(r.generatedPassword).toBeTruthy();
    expect(r.generatedPassword!.length).toBeGreaterThanOrEqual(16);
  });

  it('uloží hash, nikdy ne heslo v otevřené podobě', async () => {
    await resetPassword({
      databaseUrl: pg.ownerUrl,
      email: 'jana@firma.cz',
      password: 'nove-heslo-dost-dlouhe',
    });
    const [row] = await pg.sql<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      ['jana@firma.cz'],
    );
    expect(row!.password_hash).not.toContain('nove-heslo');
    expect(row!.password_hash.startsWith('$argon2')).toBe(true);
  });

  it('zruší všechny relace uživatele', async () => {
    await pg.sql(
      // Sloupec `expires_at` v sessions NEEXISTUJE, jmenuje se `absolute_expires_at`,
      // a `csrf_secret bytea` je NOT NULL bez defaultu. Obojí podle schématu P03.
      `INSERT INTO sessions (user_id, token_hash, csrf_secret, absolute_expires_at)
       SELECT id, sha256('token'), sha256('csrf'), now() + interval '1 day'
         FROM users WHERE email = $1`,
      ['jana@firma.cz'],
    );
    await resetPassword({
      databaseUrl: pg.ownerUrl,
      email: 'jana@firma.cz',
      password: 'jeste-jine-heslo-dost-dlouhe',
    });
    const rows = await pg.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email = $1 AND s.revoked_at IS NULL`,
      ['jana@firma.cz'],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('u neznámé adresy hodí UserNotFoundError a nic nezmění', async () => {
    await expect(
      resetPassword({ databaseUrl: pg.ownerUrl, email: 'nikdo@firma.cz', password: null }),
    ).rejects.toThrow(UserNotFoundError);
  });

  it('krátké heslo odmítne, protože délka je jediný požadavek', async () => {
    await expect(
      resetPassword({ databaseUrl: pg.ownerUrl, email: 'jana@firma.cz', password: 'krátké' }),
    ).rejects.toThrow(/10/);
  });

  it('zapíše do auditu akci user.password_reset_from_cli', async () => {
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'user.password_reset_from_cli'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
