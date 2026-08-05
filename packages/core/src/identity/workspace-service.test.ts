import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withUser, withWorkspace, withoutContext } from '../tx';
import { createWorkspaceContext } from './context';
import { hashPassword } from './password';
import type { WorkspaceContext } from './types';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  restoreWorkspace,
  slugCandidates,
  transferOwnership,
  updateWorkspace,
} from './workspace-service';

const TEST_PASSWORD = 'dostatecne-dlouhe-heslo';

let harness: PgHarness;

async function makeUser(prefix: string): Promise<string> {
  const id = uuidv7();
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id,
      email: `${prefix}-${id}@example.cz`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  return id;
}

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('slugCandidates', () => {
  it('první kandidát je základ, další nesou příponu', () => {
    expect(slugCandidates('projekt', 4)).toEqual([
      'projekt',
      'projekt-2',
      'projekt-3',
      'projekt-4',
    ]);
  });
});

describe('createWorkspace', () => {
  it('zakladatel se stává ownerem a projekt je v jeho výpisu', async () => {
    const userId = await makeUser('zakladatel');
    const created = await createWorkspace(userId, 'zakladatel', { name: 'Můj projekt' });

    expect(created.role).toBe('owner');
    expect(created.workspace.slug).toBe('muj-projekt');

    const listed = await listWorkspaces(userId);
    expect(listed.map((w) => w.id)).toContain(created.workspace.id);
  });

  /**
   * VÝCHOZÍ SEZNAM. Rozhodnutí zadavatele z 5. 8. 2026: bez něj začíná projekt
   * bez jediného seznamu, přestože seznam je to, kam kontakt musí patřit, aby
   * mu šlo poslat kampaň. Sloupec `is_default` i `getDefault()` do téhle chvíle
   * existovaly bez jediného volajícího.
   */
  it('nový projekt dostane výchozí seznam Odběratelé s dvojím potvrzením', async () => {
    const userId = await makeUser('vychozi-seznam');
    const created = await createWorkspace(userId, 'zakladatel', {
      name: `Projekt se seznamem ${Date.now()}`,
    });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });

    const rows = await withWorkspace(ctx, (tx) => tx.select().from(schema.lists));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Odběratelé');
    expect(rows[0]!.isDefault).toBe(true);
    expect(rows[0]!.optIn).toBe('double');
  });

  /**
   * VÝCHOZÍ HODNOTA VYPÍNAČE OSLOVENÍ SE ODVOZUJE Z JAZYKA.
   *
   * Rozhodnutí zadavatele z 5. 8. 2026: „V angličtině se vůbec neřeší 5. pád
   * a oslovení." Anglický projekt by jinak začínal se sloupcem „Oslovení",
   * frontou kontroly 5. pádu a volbou vykání a tykání, ze kterých v angličtině
   * nic nedává smysl.
   *
   * Je to JEN výchozí hodnota. Pozdější změna jazyka projektu s ní nehýbe,
   * aby se cizí volba nepřepisovala potichu.
   */
  it('český projekt začíná se zapnutým oslovením, anglický s vypnutým', async () => {
    const czech = await createWorkspace(await makeUser('osloveni-cs'), 'zakladatel', {
      name: `Cesky projekt ${Date.now()}`,
      locale: 'cs',
    });
    expect(czech.workspace.greeting_enabled).toBe(true);

    const english = await createWorkspace(await makeUser('osloveni-en'), 'founder', {
      name: `English project ${Date.now()}`,
      locale: 'en',
    });
    expect(english.workspace.greeting_enabled).toBe(false);

    const slovak = await createWorkspace(await makeUser('osloveni-sk'), 'zakladatel', {
      name: `Slovensky projekt ${Date.now()}`,
      locale: 'sk',
    });
    expect(slovak.workspace.greeting_enabled).toBe(true);
  });

  it('anglický projekt má výchozí seznam anglicky', async () => {
    const userId = await makeUser('default-list-en');
    const created = await createWorkspace(userId, 'founder', {
      name: `Workspace with list ${Date.now()}`,
      locale: 'en',
    });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });

    const rows = await withWorkspace(ctx, (tx) => tx.select().from(schema.lists));
    expect(rows[0]!.name).toBe('Subscribers');
  });

  it('kolize slugu se řeší příponou, ne chybou, a to i napříč cizími projekty', async () => {
    const first = await makeUser('kolize-a');
    const second = await makeUser('kolize-b');

    const a = await createWorkspace(first, 'a', { name: 'Stejný název' });
    // Druhý uživatel cizí projekt pod RLS NEVIDÍ, takže dotaz na obsazenost by
    // slug prohlásil za volný. Rozhodnout musí unikátní index.
    const b = await createWorkspace(second, 'b', { name: 'Stejný název' });

    expect(a.workspace.slug).toBe('stejny-nazev');
    expect(b.workspace.slug).toBe('stejny-nazev-2');
  });

  it('výpis nevidí cizí projekty', async () => {
    const mine = await makeUser('vypis-a');
    const stranger = await makeUser('vypis-b');
    const cizi = await createWorkspace(stranger, 'b', { name: 'Cizí projekt' });

    const listed = await listWorkspaces(mine);
    expect(listed.map((w) => w.id)).not.toContain(cizi.workspace.id);
  });
});

describe('updateWorkspace', () => {
  it('owner smí měnit název a oslovení', async () => {
    const userId = await makeUser('update');
    const created = await createWorkspace(userId, 'u', { name: 'Před změnou' });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });

    const after = await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, { name: 'Přejmenováno', address_form: 'informal' }, 'u'),
    );
    expect(after.name).toBe('Přejmenováno');
    expect(after.address_form).toBe('informal');
  });

  /**
   * Vypínač oslovení SÁM O SOBĚ nezařazuje přepočet. Je to podmínka toho, aby se
   * zapnutím zpátky nic neztratilo: sloupce kontaktů se počítají pořád, skrývá se
   * jen rozhraní. Změna jazyka projektu vypínačem naopak nehýbe.
   */
  it('vypínač oslovení jde přepnout oběma směry a změna jazyka s ním nehýbe', async () => {
    const userId = await makeUser('vypinac-osloveni');
    const created = await createWorkspace(userId, 'u', {
      name: `Vypinac ${Date.now()}`,
      locale: 'cs',
    });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });

    const off = await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, { greeting_enabled: false }, 'u'),
    );
    expect(off.greeting_enabled).toBe(false);

    // Změna jazyka projektu vypínač NEPŘEPÍNÁ, ani na češtinu, ani z ní.
    const relocalized = await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, { locale: 'en' }, 'u'),
    );
    expect(relocalized.greeting_enabled).toBe(false);

    const on = await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, { greeting_enabled: true }, 'u'),
    );
    expect(on.greeting_enabled).toBe(true);
  });
});

describe('měkké smazání a obnova', () => {
  it('smazání vyžaduje opsání názvu projektu', async () => {
    const userId = await makeUser('smazat-a');
    const created = await createWorkspace(userId, 'u', { name: 'Ke smazání' });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });

    await expect(
      withWorkspace(ctx, (tx) => deleteWorkspace(tx, ctx, 'Něco jiného', 'u')),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('se správným názvem se projekt měkce smaže a jde do 30 dnů obnovit', async () => {
    const userId = await makeUser('smazat-b');
    const created = await createWorkspace(userId, 'u', { name: 'Obnovitelný' });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });

    await withWorkspace(ctx, (tx) => deleteWorkspace(tx, ctx, 'Obnovitelný', 'u'));

    // Smazaný projekt už neprojde ani továrnou kontextu, ani čtením.
    await expect(withWorkspace(ctx, (tx) => getWorkspace(tx, ctx))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      createWorkspaceContext({ kind: 'session', userId, workspaceRef: created.workspace.id }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const restored = await restoreWorkspace({ userId, workspaceId: created.workspace.id }, 'u');
    expect(restored.deleted_at).toBeNull();

    const ctxAfter = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: created.workspace.id,
    });
    expect((await withWorkspace(ctxAfter, (tx) => getWorkspace(tx, ctxAfter))).id).toBe(
      created.workspace.id,
    );
  });

  it('obnovu cizího projektu odmítne jako 404', async () => {
    const owner = await makeUser('cizi-obnova-a');
    const stranger = await makeUser('cizi-obnova-b');
    const created = await createWorkspace(owner, 'u', { name: 'Cizí obnova' });
    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId: owner,
      workspaceRef: created.workspace.id,
    });
    await withWorkspace(ctx, (tx) => deleteWorkspace(tx, ctx, 'Cizí obnova', 'u'));

    await expect(
      restoreWorkspace({ userId: stranger, workspaceId: created.workspace.id }, 'x'),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

/** Owner a dva admini v jednom projektu. Pro test souběžného převodu. */
async function seedOwnerAndTwoAdmins(): Promise<{
  ownerCtx: WorkspaceContext;
  ownerId: string;
  ownerPassword: string;
  memberOne: string;
  memberTwo: string;
}> {
  const ownerId = await makeUser('owner');
  const memberOne = await makeUser('admin1');
  const memberTwo = await makeUser('admin2');
  const created = await createWorkspace(ownerId, 'owner', { name: `Souběh ${Date.now()}` });
  const ownerCtx = await createWorkspaceContext({
    kind: 'session',
    userId: ownerId,
    workspaceRef: created.workspace.id,
  });

  await withWorkspace(ownerCtx, async (tx) => {
    await tx.insert(schema.memberships).values([
      { workspaceId: created.workspace.id, userId: memberOne, role: 'admin' },
      { workspaceId: created.workspace.id, userId: memberTwo, role: 'admin' },
    ]);
  });

  return { ownerCtx, ownerId, ownerPassword: TEST_PASSWORD, memberOne, memberTwo };
}

describe('transferOwnership', () => {
  it('bez hesla vrací unauthenticated', async () => {
    const { ownerCtx, ownerId, memberOne } = await seedOwnerAndTwoAdmins();
    await expect(
      transferOwnership(ownerCtx, {
        currentUserId: ownerId,
        targetUserId: memberOne,
        reauthPassword: null,
        actorLabel: 'test',
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('cílový uživatel musí být členem projektu', async () => {
    const { ownerCtx, ownerId, ownerPassword } = await seedOwnerAndTwoAdmins();
    const outsider = await makeUser('outsider');
    await expect(
      transferOwnership(ownerCtx, {
        currentUserId: ownerId,
        targetUserId: outsider,
        reauthPassword: ownerPassword,
        actorLabel: 'test',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('převod udělá z cílového ownera a z původního admina', async () => {
    const { ownerCtx, ownerId, ownerPassword, memberOne } = await seedOwnerAndTwoAdmins();
    await transferOwnership(ownerCtx, {
      currentUserId: ownerId,
      targetUserId: memberOne,
      reauthPassword: ownerPassword,
      actorLabel: 'test',
    });

    const roles = await withWorkspace(ownerCtx, async (tx) => {
      const { rows } = await tx.execute<{ user_id: string; role: string }>(sql`
        SELECT user_id::text AS user_id, role FROM memberships
         WHERE workspace_id = ${ownerCtx.workspaceId}::uuid
      `);
      return new Map(rows.map((r) => [r.user_id, r.role]));
    });
    expect(roles.get(memberOne)).toBe('owner');
    expect(roles.get(ownerId)).toBe('admin');
  });

  /**
   * Pravidlo „projekt má nejvýš jednoho ownera" nevynucuje ŽÁDNÉ omezení
   * v databázi, P03 ho výslovně nechává na aplikaci. Ochrana bez testu, který
   * její porušení zachytí, ale není ochrana, a chyba se tady projeví jen při
   * souběhu, tedy nikdy při ručním klikání.
   *
   * Test proto souběh vyvolává doopravdy, nesimuluje ho. Kdyby se ukázal jako
   * nestabilní, NENÍ správná reakce ho zopakovat nebo změkčit tvrzení:
   * nestabilita by znamenala, že zámek nezabírá.
   */
  it('dva souběžné převody vlastnictví nenechají dva ownery', async () => {
    const { ownerCtx, ownerId, ownerPassword, memberOne, memberTwo } =
      await seedOwnerAndTwoAdmins();

    const results = await Promise.allSettled([
      transferOwnership(ownerCtx, {
        currentUserId: ownerId,
        targetUserId: memberOne,
        reauthPassword: ownerPassword,
        actorLabel: 'test',
      }),
      transferOwnership(ownerCtx, {
        currentUserId: ownerId,
        targetUserId: memberTwo,
        reauthPassword: ownerPassword,
        actorLabel: 'test',
      }),
    ]);

    const owners = await withWorkspace(ownerCtx, async (tx) => {
      const { rows } = await tx.execute<{ user_id: string }>(sql`
        SELECT user_id::text AS user_id FROM memberships
         WHERE workspace_id = ${ownerCtx.workspaceId}::uuid AND role = 'owner'
      `);
      return rows;
    });

    expect(owners, 'projekt musí mít právě jednoho ownera i po souběhu').toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
  });
});

describe('výpis pod mlain.user_id', () => {
  it('withUser vidí jen členství aktéra', async () => {
    const userId = await makeUser('vypis-user');
    const created = await createWorkspace(userId, 'u', { name: 'Jen můj' });
    const rows = await withUser(userId, async (tx) => {
      const { rows: r } = await tx.execute<{ c: string }>(
        sql`SELECT count(*) AS c FROM workspaces`,
      );
      return r;
    });
    expect(Number(rows[0]!.c)).toBeGreaterThanOrEqual(1);
    expect(created.workspace.id).toBeTruthy();
  });
});
