import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countSubscriptionRows,
  createActiveContact,
  createSubscription,
  createTestWorkspace,
  type TestWorkspace,
} from '../support/db';
import * as listsRepo from '../../repo/lists';
import { deleteContact, listMailableContacts, restoreContact } from '../../repo/contacts';

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

  /*
   * REGRESE. Počítadlo se ptalo jen tabulky `list_subscriptions`, ne kontaktů. Mazání
   * kontaktu je měkké a přihlášení po něm schválně zůstává, takže obrazovka seznamů
   * hlásila „50 potvrzených kontaktů" projektu, ve kterém zbyly tři, a číslo se
   * nespravilo nikdy, protože žádný úklid přihlášení neběží ani běžet nesmí.
   *
   * Test jde přes SKUTEČNOU databázi a přes SKUTEČNOU mazací cestu (`deleteContact`),
   * ne přes vymyšlená data: vada přežila právě proto, že se ověřovala nad čistou funkcí,
   * které nikdo nesmazal kontakt pod rukama.
   */
  it('smazaný kontakt se do počtu nepočítá, přihlášení mu ale zůstává', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'Novinky' });
    const zustava = await createActiveContact(ws.ctx, 'zustava@x.cz');
    const mazany = await createActiveContact(ws.ctx, 'mazany@x.cz');
    const cekajici = await createActiveContact(ws.ctx, 'cekajici@x.cz');
    await createSubscription(ws.ctx, { contactId: zustava.id, listId: a.id, status: 'confirmed' });
    await createSubscription(ws.ctx, { contactId: mazany.id, listId: a.id, status: 'confirmed' });
    await createSubscription(ws.ctx, { contactId: cekajici.id, listId: a.id, status: 'pending' });

    expect(await listsRepo.stats(ws.ctx, a.id)).toMatchObject({ confirmed: 2, pending: 1 });

    await deleteContact(ws.ctx, mazany.id, 'soft');

    expect(await listsRepo.stats(ws.ctx, a.id)).toMatchObject({
      confirmed: 1,
      pending: 1,
      total: 2,
    });
    // Řádek přihlášení musí přežít, jinak by obnova do třiceti dnů vrátila člověka
    // bez členství. Kdyby se tahle kontrola smazala, dala by se vada „opravit" úklidem,
    // který uživateli tiše sebere seznamy.
    expect(await countSubscriptionRows(ws.ctx, a.id)).toBe(3);

    await restoreContact(ws.ctx, mazany.id);
    expect(await listsRepo.stats(ws.ctx, a.id)).toMatchObject({ confirmed: 2, pending: 1 });
  }, 30_000);

  /*
   * Zablokovaná a odhlášená adresa se počítat MÁ. Je to ochrana příjemce, ne nepřítomnost
   * člověka, a uživatel musí na obrazovce vidět, že tam ten člověk je a proč mu nepíšeme.
   */
  it('odhlášený kontakt z počtu nemizí, jen sedí ve svém stavu', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'Novinky' });
    const odhlaseny = await createActiveContact(ws.ctx, 'odhlaseny@x.cz');
    await createSubscription(ws.ctx, {
      contactId: odhlaseny.id,
      listId: a.id,
      status: 'unsubscribed',
    });

    expect(await listsRepo.stats(ws.ctx, a.id)).toMatchObject({
      unsubscribed: 1,
      confirmed: 0,
      total: 1,
    });
  }, 30_000);

  /*
   * Počítadlo a výběr příjemců musí odpovídat na tutéž otázku „je ten člověk v projektu".
   * Kdyby se rozešly, obrazovka by slíbila padesát a odešlo by třem, což je přesně ta
   * vada, kterou tenhle soubor hlídá.
   */
  it('počet potvrzených sedí s tím, komu kampaň doopravdy odejde', async () => {
    const a = await listsRepo.create(ws.ctx, { name: 'Novinky' });
    for (const email of ['a@x.cz', 'b@x.cz', 'c@x.cz']) {
      const contact = await createActiveContact(ws.ctx, email);
      await createSubscription(ws.ctx, {
        contactId: contact.id,
        listId: a.id,
        status: 'confirmed',
      });
    }
    const smazany = await createActiveContact(ws.ctx, 'd@x.cz');
    await createSubscription(ws.ctx, { contactId: smazany.id, listId: a.id, status: 'confirmed' });
    await deleteContact(ws.ctx, smazany.id, 'soft');

    const counted = await listsRepo.stats(ws.ctx, a.id);
    const mailable = await listMailableContacts(ws.ctx, { listId: a.id });
    expect(counted.confirmed).toBe(mailable.length);
    expect(counted.confirmed).toBe(3);
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
