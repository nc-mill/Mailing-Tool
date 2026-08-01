import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { appPool, closePools, withoutContext, withWorkspace } from '../tx';
import type { ApiError } from '../errors/api-error';
import { hashPassword } from './password';
import { createWorkspaceContext } from './context';

/**
 * ODCHYLKA OD PLÁNU ve způsobu, jak se v tomhle souboru zakládá projekt.
 *
 * Plán tu měl ruční `tx.insert(schema.workspaces).values({...}).returning()`
 * uvnitř `withUser`. To NEPROJDE a ověřeno je to spuštěním: skončí na
 * SQLSTATE 42501, „new row violates row-level security policy for table
 * workspaces". Důvod popisuje sám plán u úkolů 20 a 22: `INSERT ... RETURNING`
 * uplatní na nový řádek i politiky pro ČTENÍ, a `ws_insert_bootstrap` je
 * FOR INSERT, takže na RETURNING nedosáhne. U úkolu 18 zůstalo v plánu starší,
 * rozbité znění. Zakládá se proto `createWorkspaceAsUser` z `@mlain/db`,
 * tedy stejně jako ve zbytku sady; ta funkce navíc rovnou vloží i členství.
 */

let harness: PgHarness;
let userA = '';
let userB = '';
let wsA = '';
let slugA = '';

beforeAll(async () => {
  harness = await startPgHarness();

  const seed = await withoutContext(async (tx) => {
    const [a] = await tx
      .insert(schema.users)
      .values({
        email: `a-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    const [b] = await tx
      .insert(schema.users)
      .values({
        email: `b-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return { a: a!.id, b: b!.id };
  });
  userA = seed.a;
  userB = seed.b;

  const slug = `ws-${Date.now()}`;
  const created = await createWorkspaceAsUser(appPool(), userA, {
    name: 'A',
    slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  wsA = created.id;
  slugA = slug;
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('createWorkspaceContext pro uživatele', () => {
  it('člen dostane kontext se svou rolí', async () => {
    const ctx = await createWorkspaceContext({ kind: 'session', userId: userA, workspaceRef: wsA });
    expect(ctx.workspaceId).toBe(wsA);
    expect(ctx.actor).toEqual({ type: 'user', userId: userA, role: 'owner' });
  });

  it('funguje i podle slugu z cesty /w/{slug}', async () => {
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId: userA,
      workspaceRef: slugA,
    });
    expect(ctx.workspaceId).toBe(wsA);
  });

  it('nečlen dostane 404, ne 403 (3.4, ochrana proti enumeraci ID)', async () => {
    try {
      await createWorkspaceContext({ kind: 'session', userId: userB, workspaceRef: wsA });
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('not_found');
      expect(err.status).toBe(404);
    }
  });

  it('neexistující workspace dostane taky 404, aby šly odpovědi rozlišit jen členstvím', async () => {
    await expect(
      createWorkspaceContext({
        kind: 'session',
        userId: userA,
        workspaceRef: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6099',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('nesmyslná reference nespadne na chybě databáze, ale na 404', async () => {
    await expect(
      createWorkspaceContext({
        kind: 'session',
        userId: userA,
        workspaceRef: 'neni-uuid-ani-slug!!',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('měkce smazaný workspace není dostupný', async () => {
    // Projekt se založí normálně a teprve pak se měkce smaže. Založit ho rovnou
    // s `deleted_at` nejde: `INSERT ... RETURNING` na `workspaces` neprojde přes
    // politiky pro čtení, viz komentář nahoře.
    const del = await createWorkspaceAsUser(appPool(), userA, {
      name: 'Del',
      slug: `del-${Date.now()}`,
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
    const ctxDel = await createWorkspaceContext({
      kind: 'session',
      userId: userA,
      workspaceRef: del.id,
    });
    await withWorkspace(ctxDel, async (tx) => {
      await tx.execute(sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${del.id}::uuid`);
    });

    await expect(
      createWorkspaceContext({ kind: 'session', userId: userA, workspaceRef: del.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('createWorkspaceContext pro API klíč', () => {
  it('workspace se bere z klíče, nikdy z requestu', async () => {
    const ctx = await createWorkspaceContext({
      kind: 'api_key',
      apiKeyId: '0192f3a0-1c2d-7e44-8d4e-5f60718293a4',
      workspaceId: wsA,
      scopes: ['contacts:read'],
    });
    expect(ctx.workspaceId).toBe(wsA);
    expect(ctx.actor).toEqual({
      type: 'api_key',
      apiKeyId: '0192f3a0-1c2d-7e44-8d4e-5f60718293a4',
      scopes: ['contacts:read'],
    });
  });
});

describe('systémový kontext', () => {
  it('nese název jobu, aby šlo v auditu dohledat, co ho vyvolalo', async () => {
    const ctx = await createWorkspaceContext({
      kind: 'system',
      job: 'platform.webhook_deliver',
      workspaceId: wsA,
    });
    expect(ctx.actor).toEqual({ type: 'system', job: 'platform.webhook_deliver' });
  });
});
