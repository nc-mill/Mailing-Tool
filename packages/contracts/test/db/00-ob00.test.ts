import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractSqlDir, type ContractDb, startContractDb, stopContractDb } from './helpers';

let db: ContractDb;

beforeAll(async () => {
  db = await startContractDb();
}, 180_000);

afterAll(async () => {
  await stopContractDb(db);
});

describe('OB-00: každý normativní dotaz kontraktu projde parserem a plánovačem', () => {
  it('najde všech jedenáct normativních dotazů', async () => {
    const files = (await readdir(contractSqlDir)).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toHaveLength(11);
  });

  it('spustí každý dotaz pod rolí, které podle kontraktu patří', async () => {
    const files = (await readdir(contractSqlDir)).filter((f) => f.endsWith('.sql')).sort();
    const failures: string[] = [];

    for (const file of files) {
      const raw = await readFile(path.join(contractSqlDir, file), 'utf8');
      const stmt = parseContractStatement(file, raw);
      const client = stmt.role === 'sender' ? db.sender : db.app;
      const name = `ob00_${file.replace(/\W/g, '_')}`;

      try {
        await client.query(`PREPARE ${name}${paramList(stmt.paramTypes)} AS ${stmt.sql}`);
        await client.query(`EXPLAIN (COSTS OFF) EXECUTE ${name}${argList(stmt.args)}`);
      } catch (error) {
        failures.push(`${file}: ${(error as Error).message}`);
      } finally {
        await client.query(`DEALLOCATE ALL`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('odmítne tvar claimu, který kontrakt výslovně zakazuje', async () => {
    // Pojistka proti tomu, aby se do kontraktu vrátil odkaz na cíl UPDATE
    // uvnitř klauzule ON. Kdyby PostgreSQL tenhle tvar někdy přijal, přestal
    // by být důvod pro zápis s čárkami a plán by o tu informaci přišel.
    //
    // POZOR na to, KDE ta věta je. PostgreSQL vrací hlavní hlášku
    //   invalid reference to FROM-clause entry for table "m"
    // a teprve v poli DETAIL
    //   There is an entry for table "m", but it cannot be referenced from this part of the query.
    // Ovladač pg mapuje hlavní hlášku na `message` a DETAIL na `detail`, takže
    // toThrow() nad `message` by tuhle větu NIKDY nenašel a test by spadl.
    // Ověřeno spuštěním na PostgreSQL 18.4.
    const error = await db.sender
      .query(
        `
        PREPARE ob00_forbidden (text, int, uuid) AS
        WITH claimable AS (
          SELECT m.id, m.created_at FROM messages m
          WHERE m.campaign_id = $3 AND m.status = 'pending'
          LIMIT $2 FOR UPDATE OF m SKIP LOCKED
        )
        UPDATE messages m SET status = 'claimed', claimed_by = $1
        FROM claimable cl JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.id = cl.id AND m.created_at = cl.created_at
      `,
      )
      .then(
        () => undefined,
        (reason: unknown) => reason as Error & { code?: string; detail?: string },
      );

    expect(error, 'zakázaný tvar claimu musel selhat').toBeDefined();
    expect(error!.code).toBe('42P01');
    expect(error!.message).toMatch(/invalid reference to FROM-clause entry for table "m"/);
    expect(error!.detail).toMatch(/cannot be referenced from this part of the query/);
  });
});

type ContractStatement = {
  sql: string;
  role: 'sender' | 'app';
  paramTypes: string[];
  args: string[];
};

/**
 * Prázdný seznam se píše BEZ ZÁVOREK. `PREPARE jméno () AS ...` i `EXECUTE jméno()`
 * jsou v PostgreSQL syntaktická chyba `syntax error at or near ")"`, a dva
 * z jedenácti normativních dotazů parametry nemají. Ověřeno na PostgreSQL 18.4.
 */
const paramList = (types: readonly string[]): string =>
  types.length === 0 ? '' : ` (${types.join(', ')})`;
const argList = (args: readonly string[]): string =>
  args.length === 0 ? '' : `(${args.join(', ')})`;

function parseContractStatement(file: string, raw: string): ContractStatement {
  const directive = (name: string): string => {
    // [^\S\n] je "bílý znak kromě konce řádku". Se \s by se výraz protáhl přes
    // konec řádku a u direktivy s prázdnou hodnotou by jako hodnotu sebral
    // NÁSLEDUJÍCÍ řádek: `-- params:` by vrátilo "-- args:" a vzniklo by
    // neplatné SQL. Týká se to dvou souborů z jedenácti.
    const match = raw.match(new RegExp(`^--[^\\S\\n]*${name}:[^\\S\\n]*(.*)$`, 'm'));
    if (!match) throw new Error(`${file}: chybí direktiva -- ${name}:`);
    // ?? '' je kvůli noUncheckedIndexedAccess: true v presetu tsconfig.
    return (match[1] ?? '').trim();
  };
  const role = directive('role');
  if (role !== 'sender' && role !== 'app')
    throw new Error(`${file}: role musí být sender nebo app`);
  const paramsRaw = directive('params');
  const argsRaw = directive('args');
  const paramTypes = paramsRaw === '' ? [] : paramsRaw.split(',').map((s) => s.trim());
  const args = argsRaw === '' ? [] : splitArgs(argsRaw);
  if (paramTypes.length !== args.length) {
    throw new Error(`${file}: params má ${paramTypes.length} položek, args ${args.length}`);
  }
  return {
    sql: raw
      .replace(/^--.*$/gm, '')
      .trim()
      .replace(/;\s*$/, ''),
    role,
    paramTypes,
    args,
  };
}

function splitArgs(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of input) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === '(' || ch === '[')) depth += 1;
    if (!quoted && (ch === ')' || ch === ']')) depth -= 1;
    if (ch === ',' && depth === 0 && !quoted) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}
