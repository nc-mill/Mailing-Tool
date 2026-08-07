import { beforeEach, describe, expect, it } from 'vitest';
import { unsubscribe } from '../../../contacts/lists/unsubscribe';
import { restrictProcessing } from '../../../contacts/repo/contacts';
import { addSuppression } from '../../../contacts/repo/suppressions';
import { withWorkspace } from '../../../tx';
import { seedMessages, withTestWorkspace, type TestWorkspace } from '../../test/harness';
import { rawSql } from '../raw-sql';

/**
 * DŮKAZ, že odhlášení SKUTEČNĚ zruší připravenou zprávu, na celé cestě a bez podvržení.
 *
 * Tenhle soubor je jediný ze všech, které se portu `revokePendingMessages` týkají,
 * jenž ho NEREGISTRUJE. Ostatní testy portu podstrkují `vi.fn()` a ověřují, že se
 * zavolá se správným rozsahem. To je užitečné, ale vadu, kvůli které tenhle soubor
 * vznikl, nemohly zachytit ZE SVÉ PODSTATY: chyběla právě ta implementace, kterou si
 * podvrhly. Port měl tělo `if (implementation === null) return { revoked: 0 }`
 * a nikdo kromě testů ho neregistroval, takže se člověk odhlásil, produkt odpověděl
 * „zrušeno nula" a připravená zpráva mu odešla. Tiše.
 *
 * Měřítko je proto řádek v `messages`, ne počet volání odposlouchávané funkce.
 */
describe('zrušení připravené pošty vede od domény kontaktů až do messages', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  async function messageStates(contactId: string): Promise<{ status: string; code: string }[]> {
    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string | null }>(
        rawSql(
          `SELECT status, error_code FROM messages
            WHERE contact_id = $1 ORDER BY created_at, id`,
          [contactId],
        ),
      ),
    );
    return rows.rows.map((r) => ({ status: r.status, code: r.error_code ?? '' }));
  }

  it('odhlášení ze seznamu zruší připravenou zprávu kampaně toho seznamu', async () => {
    const seeded = await seedMessages(ctx, {
      statuses: ['pending'],
      twoCampaignsWithDifferentLists: true,
    });

    await unsubscribe(ctx.workspace, {
      contactId: seeded.contactId,
      listId: seeded.listA,
      reason: 'link',
    });

    // Rozsah drží: zpráva z kampaně nad seznamem B zůstává, protože z něj se
    // člověk neodhlásil. Kdyby se zrušila taky, byla by to tichá ztráta pošty.
    // Pořadí řádků se nekontroluje, obě zprávy vznikly ve stejné vteřině.
    expect(await messageStates(seeded.contactId)).toEqual(
      expect.arrayContaining([
        { status: 'skipped', code: 'unsubscribed' },
        { status: 'pending', code: '' },
      ]),
    );
  });

  it('globální odhlášení zruší připravené zprávy ze všech kampaní', async () => {
    const seeded = await seedMessages(ctx, {
      statuses: ['pending'],
      twoCampaignsWithDifferentLists: true,
    });

    await unsubscribe(ctx.workspace, {
      contactId: seeded.contactId,
      listId: null,
      reason: 'one_click',
    });

    const states = await messageStates(seeded.contactId);
    expect(states.every((s) => s.status === 'skipped')).toBe(true);
    expect(states).toHaveLength(2);
  });

  it('zápis na blokované adresy zruší připravenou zprávu', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['pending'] });

    await addSuppression(ctx.workspace, {
      email: seeded.email,
      reason: 'manual',
      source: 'manual',
    });

    expect(await messageStates(seeded.contactId)).toEqual([
      { status: 'skipped', code: 'suppressed' },
    ]);
  });

  it('omezení zpracování podle článku 18 zruší připravenou zprávu', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['pending'] });

    await restrictProcessing(ctx.workspace, seeded.contactId);

    expect(await messageStates(seeded.contactId)).toEqual([
      { status: 'skipped', code: 'processing_restricted' },
    ]);
  });

  it('claimnutá zpráva se ani touhle cestou NERUŠÍ, sender ji může mít v ruce', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['claimed'] });

    await unsubscribe(ctx.workspace, {
      contactId: seeded.contactId,
      listId: null,
      reason: 'link',
    });

    expect(await messageStates(seeded.contactId)).toEqual([{ status: 'claimed', code: '' }]);
  });
});
