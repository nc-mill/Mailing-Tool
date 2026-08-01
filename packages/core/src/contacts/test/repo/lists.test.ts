import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorkspace, type TestWorkspace } from '../support/db';
import * as listsRepo from '../../repo/lists';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ POŘADÍM HÁKŮ. Plán měl `const ws = await createTestWorkspace()`
 * na úrovni modulu. Modul se ale vyhodnocuje PŘED `beforeAll`, tedy dřív, než vůbec běží
 * kontejner, takže by projekt neměl kde vzniknout. Zakládá se proto ve vlastním `beforeAll`,
 * který vitest spustí až po tom ze `support/db`.
 */
let ws: TestWorkspace;

beforeAll(async () => {
  ws = await createTestWorkspace();
}, 60_000);

afterAll(() => ws.cleanup());

beforeEach(() => ws.truncate(['list_subscriptions', 'lists', 'contacts', 'audit_log']));

describe('lists.create', () => {
  it('doplní výchozí hodnoty domény, ne hodnoty z DDL', async () => {
    const list = await listsRepo.create(ws.ctx, { name: 'Newsletter' });
    expect(list.optIn).toBe('double');
    // Výchozí hodnota sloupce v DDL je 'two_step', doménová je 'one_step' (rozhodnutí R2).
    expect(list.confirmationMode).toBe('one_step');
    expect(list.confirmationTtlHours).toBe(168);
    expect(list.confirmationMaxResends).toBe(3);
    expect(list.sendWelcome).toBe(false);
    expect(list.isDefault).toBe(false);
  });

  it('odmítne druhý seznam se stejným jménem bez ohledu na velikost písmen', async () => {
    await listsRepo.create(ws.ctx, { name: 'Newsletter' });
    // ODCHYLKA OD PLÁNU: kód `list_name_taken` není registrovaný v P01, takže se vrací
    // platformní `already_exists` s doménovou příčinou v params.detail. Viz repo/lists.ts.
    await expect(listsRepo.create(ws.ctx, { name: 'newsletter' })).rejects.toMatchObject({
      code: 'already_exists',
      params: { detail: 'list_name_taken' },
    });
  });

  it('po archivaci se jméno uvolní, protože unikátní index je částečný', async () => {
    const first = await listsRepo.create(ws.ctx, { name: 'Newsletter' });
    await listsRepo.archive(ws.ctx, first.id);
    const second = await listsRepo.create(ws.ctx, { name: 'Newsletter' });
    expect(second.id).not.toBe(first.id);
  });

  it('zapíše audit list.created', async () => {
    const list = await listsRepo.create(ws.ctx, { name: 'Newsletter' });
    expect(await ws.auditActions()).toContain('list.created');
    expect(await ws.lastAuditTargetId()).toBe(list.id);
  });
});

describe('lists.setDefault', () => {
  it('přehodí výchozí seznam a nikdy nenechá dva zároveň', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'A', isDefault: true });
    const b = await listsRepo.create(ws.ctx, { name: 'B' });

    await listsRepo.setDefault(ws.ctx, b.id);

    expect((await listsRepo.byId(ws.ctx, a.id))?.isDefault).toBe(false);
    expect((await listsRepo.byId(ws.ctx, b.id))?.isDefault).toBe(true);
    expect((await listsRepo.getDefault(ws.ctx))?.id).toBe(b.id);
  });

  it('archivovaný seznam nejde nastavit jako výchozí', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'A' });
    await listsRepo.archive(ws.ctx, a.id);
    await expect(listsRepo.setDefault(ws.ctx, a.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('lists.archive', () => {
  it('nastaví deleted_at, shodí is_default a seznam zmizí z výpisu', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'A', isDefault: true });
    await listsRepo.archive(ws.ctx, a.id);

    const row = await listsRepo.byId(ws.ctx, a.id, { includeArchived: true });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    // Archivovaný výchozí seznam by dál chytal každé přihlášení bez uvedeného seznamu.
    expect(row?.isDefault).toBe(false);

    expect(await listsRepo.list(ws.ctx)).toEqual([]);
    expect((await listsRepo.list(ws.ctx, { includeArchived: true })).map((l) => l.id)).toEqual([
      a.id,
    ]);
    expect(await listsRepo.getDefault(ws.ctx)).toBeNull();
  });
});

describe('lists.update', () => {
  it('změna opt_in z double na single se zapíše do auditu', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'A' });
    await listsRepo.update(ws.ctx, a.id, { optIn: 'single' });
    expect(await ws.auditActions()).toContain('list.opt_in_changed');
  });

  it('změna popisu audit opt_in nezapíše', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'A' });
    await listsRepo.update(ws.ctx, a.id, { description: 'nový popis' });
    expect(await ws.auditActions()).not.toContain('list.opt_in_changed');
  });
});

describe('lists.stats', () => {
  it('vrátí počty podle stavu a nuly u chybějících stavů', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'A' });
    await ws.seedSubscriptions(a.id, ['confirmed', 'confirmed', 'pending', 'unsubscribed']);

    expect(await listsRepo.stats(ws.ctx, a.id)).toEqual({
      pending: 1,
      confirmed: 2,
      unsubscribed: 1,
      bounced: 0,
      complained: 0,
      total: 4,
    });
  }, 30_000);
});

describe('lists.nameTaken', () => {
  it('nerozlišuje velikost písmen a archivované seznamy nepočítá', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'Newsletter' });
    expect(await listsRepo.nameTaken(ws.ctx, 'NEWSLETTER')).toBe(true);
    await listsRepo.archive(ws.ctx, a.id);
    expect(await listsRepo.nameTaken(ws.ctx, 'newsletter')).toBe(false);
  });
});

describe('izolace projektů', () => {
  it('seznam cizího projektu se nenajde', async () => {
    const other = await createTestWorkspace();
    const foreign = await listsRepo.create(other.ctx, { name: 'Cizí' });
    expect(await listsRepo.byId(ws.ctx, foreign.id)).toBeNull();
    await other.cleanup();
  });
});
