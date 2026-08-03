import { describe, expect, it } from 'vitest';
import {
  archiveContactField,
  createContactField,
  getContactField,
  requestFieldIndex,
} from '../../repo/contact-fields';
import { verifyFieldIndex } from '../../jobs/verify-field-index';
import {
  asAppRole,
  asMigrator,
  enqueuedJobNames,
  explainAttributeLookup,
  indexNamesOnContacts,
  seedContactsWithAttribute,
  testContext,
} from '../support/db';

describe('prověrka dotazovatelnosti vlastního pole', () => {
  it('žádost nastaví stav building a zařadí job', async () => {
    const ctx = await testContext();
    const { id } = await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'C' } });
    await requestFieldIndex(ctx, id);
    expect((await getContactField(ctx, id)).indexState).toBe('building');
    const enqueued = await enqueuedJobNames(ctx);
    expect(enqueued.filter((n) => n === 'contact_fields.verify_index')).toHaveLength(1);

    // Jméno, pod kterým se úloha SKUTEČNĚ zařadila, musí být v registru front.
    // Rozešlo se to už jednou: producent zařazoval 'contact_fields.verify_index',
    // registr znal 'contact_fields.build_index', fronta se založila bez obsluhy
    // a index vlastních polí se tiše nepřestavoval. Nic přitom nespadlo.
    const { QUEUE_REGISTRY } = await import('../../../queues/index');
    expect(
      QUEUE_REGISTRY.map((q) => q.name),
      'producent zařazuje úlohu pod jménem, které registr front nezná',
    ).toContain('contact_fields.verify_index');
  });

  it('devátá žádost se odmítne, i když předchozí ještě běží', async () => {
    const ctx = await testContext();
    for (let i = 0; i < 8; i += 1) {
      const field = await createContactField(ctx, {
        key: `f${i}`,
        type: 'text',
        label: { en: 'F' },
      });
      await requestFieldIndex(ctx, field.id);
    }
    // Limit se počítá přes indexed I building. Dřívější znění počítalo jen indexed,
    // takže osm souběžných žádostí prošlo všech osm a devátá taky: limit by platil
    // až po doběhnutí jobů, tedy přesně tehdy, kdy už ho není potřeba.
    const { id } = await createContactField(ctx, { key: 'f8', type: 'text', label: { en: 'F' } });
    await expect(requestFieldIndex(ctx, id)).rejects.toMatchObject({
      code: 'too_many_items',
      params: { detail: 'indexed_field_limit_reached' },
    });
  }, 30_000);

  it('job nastaví ready a NEZAKLÁDÁ žádný index', async () => {
    const ctx = await testContext();
    const { id } = await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'C' } });
    await requestFieldIndex(ctx, id);
    const before = await indexNamesOnContacts();
    await verifyFieldIndex({ workspaceId: ctx.workspaceId, fieldId: id });
    expect((await getContactField(ctx, id)).indexState).toBe('ready');
    // REGRESE proti dřívějšímu znění: doména nesmí vyrobit jediný nový index.
    // Kdyby to zkusila, spadla by na 42501, protože tabulku nevlastní.
    expect(await indexNamesOnContacts()).toEqual(before);
  });

  it('prověrka opravdu použije existující GIN index nad attributes', async () => {
    const ctx = await testContext();
    const { id } = await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'C' } });
    await seedContactsWithAttribute(ctx, 'city', 'Brno', 2000);
    await requestFieldIndex(ctx, id);
    await verifyFieldIndex({ workspaceId: ctx.workspaceId, fieldId: id });
    // Test se ptá PLÁNOVAČE, ne kódu. Kdyby index idx_contacts__attributes_gin
    // zmizel nebo se v P03 přejmenoval, tenhle test spadne, zatímco stav ready
    // by se nastavil dál a nikdo by si toho nevšiml.
    const plan = await explainAttributeLookup(ctx, 'city', 'Brno');
    expect(plan).toMatch(/idx_contacts__attributes_gin/);
  }, 30_000);

  it('druhý běh jobu nespadne a stav nechá na ready', async () => {
    const ctx = await testContext();
    const { id } = await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'C' } });
    await requestFieldIndex(ctx, id);
    const payload = { workspaceId: ctx.workspaceId, fieldId: id };
    await verifyFieldIndex(payload);
    await expect(verifyFieldIndex(payload)).resolves.not.toThrow();
    expect((await getContactField(ctx, id)).indexState).toBe('ready');
  });

  it('archivované pole se prověrkou nezapne', async () => {
    const ctx = await testContext();
    const { id } = await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'C' } });
    await requestFieldIndex(ctx, id);
    await archiveContactField(ctx, id);
    await verifyFieldIndex({ workspaceId: ctx.workspaceId, fieldId: id });
    expect((await getContactField(ctx, id)).indexState).toBe('failed');
    expect((await getContactField(ctx, id)).indexed).toBe(false);
  });

  it('doména nemá právo založit index, i kdyby chtěla', async () => {
    // Přímý důkaz toho, proč se DDL z domény negeneruje. Kdyby tenhle test začal
    // procházet, znamenalo by to, že někdo aplikační roli rozšířil o vlastnictví
    // tabulky, a to je změna, která patří do P03 a do revize, ne do běhu.
    await expect(
      asAppRole().query(`CREATE INDEX idx_pokus ON contacts ((attributes ->> 'city'))`),
    ).rejects.toThrow(/must be owner|permission denied/i);
    // Migrátor ho založit smí, což dokládá, že test neselhal z jiného důvodu.
    await asMigrator().query(`CREATE INDEX idx_pokus ON contacts ((attributes ->> 'city'))`);
    await asMigrator().query(`DROP INDEX idx_pokus`);
  });
});
