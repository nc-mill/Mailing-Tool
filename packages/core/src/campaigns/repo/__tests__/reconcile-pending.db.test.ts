import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addSuppression,
  seedMessages,
  withTestWorkspace,
  type TestWorkspace,
} from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { reconcilePending } from '../outbox';
import { rawSql } from '../raw-sql';

/**
 * ZACHYTNA CESTA `outbox.reconcile` nad vsemi sesti duvody.
 *
 * Puvodne umela jen blokovane adresy (`reconcileSuppressed`), takze odhlaseny,
 * vymazany, smazany ani omezeny clovek jeji ochranou nebyl kryty vubec. Tenhle
 * soubor drzi obe strany: co zrusit MUSI, a hlavne co zrusit NESMI. Druhy smer
 * je nebezpecnejsi, protoze neodeslana zprava je videt, kdezto omylem zrusena
 * kampan se pozna az z reportu.
 */
describe('rekonciliace cekajici posty podle soucasneho stavu kontaktu', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  async function states(contactId: string): Promise<{ status: string; code: string }[]> {
    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string | null }>(
        rawSql(`SELECT status, error_code FROM messages WHERE contact_id = $1`, [contactId]),
      ),
    );
    return rows.rows.map((r) => ({ status: r.status, code: r.error_code ?? '' }));
  }

  async function patchContact(contactId: string, setSql: string): Promise<void> {
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`UPDATE contacts SET ${setSql} WHERE id = $1 AND workspace_id = $2`, [
          contactId,
          ctx.workspaceId,
        ]),
      ),
    );
  }

  it('vymazany podle clanku 17 ma prednost pred vsemi ostatnimi duvody', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    // Splnuje naraz ctyri podminky. Report potrebuje ten pravne nejsilnejsi.
    await patchContact(
      contactId,
      `anonymized_at = now(), deleted_at = now(), processing_restricted = true,
       status = 'unsubscribed'`,
    );

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'contact_anonymized' }]);
  });

  it('smazany kontakt', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await patchContact(contactId, `deleted_at = now()`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'contact_deleted' }]);
  });

  it('omezene zpracovani podle clanku 18', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await patchContact(contactId, `processing_restricted = true`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'processing_restricted' }]);
  });

  it('blokovana adresa', async () => {
    const { contactId, email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual' });

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'suppressed' }]);
  });

  it('globalne odhlaseny kontakt', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await patchContact(contactId, `status = 'unsubscribed'`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'unsubscribed' }]);
  });

  it('zmeneny stav kontaktu (tvrdy odraz) je vlastni duvod, ne odhlaseni', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await patchContact(contactId, `status = 'bounced'`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([
      { status: 'skipped', code: 'contact_status_changed' },
    ]);
  });

  /**
   * `messages.contact_id` je NOT NULL, ale cizi klic na `contacts` NEMA (tabulka
   * je partitionovana). Tvrdy vymaz kontaktu tedy nechava v outboxu radek, ktery
   * odkazuje na nikoho, a okamzita cesta uz na nej nedosahne: ta hleda podle
   * kontaktu. Tohle je jeden ze ctyr duvodu, proc zachytna cesta existuje.
   */
  it('cekajici zprava adresy BEZ radku kontaktu se zrusi podle blokovanych adres', async () => {
    const { contactId, email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'hard_bounce' });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`DELETE FROM contacts WHERE id = $1 AND workspace_id = $2`, [
          contactId,
          ctx.workspaceId,
        ]),
      ),
    );

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'suppressed' }]);
  });

  it('osirela zprava BEZ blokovane adresy se nerusi, o kontaktu nic nevime', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`DELETE FROM contacts WHERE id = $1 AND workspace_id = $2`, [
          contactId,
          ctx.workspaceId,
        ]),
      ),
    );

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
  });

  /**
   * KRITERIUM 79 pro zachytnou cestu. Nejnebezpecnejsi test v souboru: kdyby
   * rekonciliace ignorovala rozsah, prisel by clovek odhlaseny z jednoho
   * newsletteru o vsechny ostatni, na ktere zustal prihlaseny.
   */
  it('odhlaseni z jednoho seznamu NEZRUSI postu kampani jinych seznamu', async () => {
    const seeded = await seedMessages(ctx, {
      statuses: ['pending'],
      twoCampaignsWithDifferentLists: true,
    });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source,
                                           unsubscribed_at)
           VALUES ($1, $2, $3, 'unsubscribed', 'manual', now())`,
          [seeded.contactId, seeded.listA, ctx.workspaceId],
        ),
      ),
    );

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(seeded.contactId)).toEqual(
      expect.arrayContaining([
        { status: 'skipped', code: 'unsubscribed' },
        { status: 'pending', code: '' },
      ]),
    );
  });

  /**
   * TRANSAKCNI POSTA SE RIDI JINYM PRAVIDLEM NEZ KAMPAN a je to ta polovina,
   * kterou tenhle soubor puvodne neumel: mel devet testu na to, co zrusit MA,
   * a ani jeden na druh zpravy.
   *
   * Potvrzeni dvojiho souhlasu jde z definice na kontakt ve stavu `unconfirmed`,
   * protoze prave tim se z nej stane `active`. Dokud CASE nedelil postu podle
   * druhu, sedla na nej podminka `c.status <> 'active'` VZDYCKY a prihlaseni
   * pres formular nedoslo nikdy. Nevypadalo to jako chyba: radek v `messages`
   * existoval a nesl verohodny duvod `contact_status_changed`. Zmereno 7. 8. 2026
   * na dvou skutecnych prihlasenich, obe zrusena do minuty po vzniku.
   */
  async function seedTransactional(status: string): Promise<{ contactId: string; email: string }> {
    const contactId = randomUUID();
    const email = `optin-${contactId}@example.com`;
    await withWorkspace(ctx.workspace, async (tx) => {
      await tx.execute(
        rawSql(
          `INSERT INTO contacts (id, workspace_id, email, status, email_fingerprints)
           VALUES ($1, $2, $3, $4, ARRAY[decode(md5(lower($3)), 'hex')])`,
          [contactId, ctx.workspaceId, email, status],
        ),
      );
      // Bez `campaign_id`: transakcni zprava k zadne kampani nepatri, takze
      // `unsubscribe_list_id` nema odkud vzit a vetev rozsahu odhlaseni na ni
      // nemuze dosahnout ani omylem.
      await tx.execute(
        rawSql(
          `INSERT INTO messages (workspace_id, contact_id, kind, email, status)
           VALUES ($1, $2, 'transactional', $3, 'pending')`,
          [ctx.workspaceId, contactId, email],
        ),
      );
    });
    return { contactId, email };
  }

  it('potvrzeni dvojiho souhlasu NEPRODLENE kontaktu ve stavu unconfirmed ZUSTANE', async () => {
    const { contactId } = await seedTransactional('unconfirmed');

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'pending', code: '' }]);
  });

  /**
   * Odhlaseni se tyka MARKETINGU, ne provozni posty. Clovek, ktery se odhlasil
   * a pak si znovu vyplnil prihlasovaci formular, potrebuje potvrzovaci odkaz
   * dostat, jinak se zpatky prihlasit NEMA JAK.
   */
  it('transakcni posta odhlasenemu kontaktu ZUSTANE, odhlaseni plati na kampane', async () => {
    const { contactId } = await seedTransactional('unsubscribed');

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'pending', code: '' }]);
  });

  /**
   * Druha strana teze mince: deleni podle druhu zpravy se tyka JEN prekazek
   * odvozenych ze souhlasu. Tvrde prekazky plati dal na vsechno, jinak by se
   * z transakcni posty stala zadni vratka kolem clanku 17 a blokovanych adres.
   */
  it('transakcni posta VYMAZANEMU kontaktu se rusi, tvrda prekazka plati na vsechno', async () => {
    const { contactId } = await seedTransactional('unconfirmed');
    await patchContact(contactId, `deleted_at = now()`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'contact_deleted' }]);
  });

  it('transakcni posta na BLOKOVANOU adresu se rusi', async () => {
    const { contactId, email } = await seedTransactional('unconfirmed');
    await addSuppression(ctx, { email, reason: 'complaint' });

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'suppressed' }]);
  });

  it('aktivni kontakt bez jedine zavady o postu NEPRIJDE', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'pending', code: '' }]);
  });

  it('mekce odebrana suppression (removed_at) nerusi nic', async () => {
    const { contactId, email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual', removed: true });

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'pending', code: '' }]);
  });

  it('claimnuta zprava se NEMENI, sender ji muze mit prave v ruce', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['claimed'] });
    await patchContact(contactId, `status = 'unsubscribed', processing_restricted = true`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'claimed', code: '' }]);
  });

  it('uz odeslana zprava se zpetne nemeni', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['sent'] });
    await patchContact(contactId, `deleted_at = now()`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'sent', code: '' }]);
  });

  /**
   * IDEMPOTENCE, overena dvema behy, ne uvahou. Uloha tika kazdou minutu a jeji
   * vlastni komentar to slibuje; kdyby druhy beh rusil znovu, hlasil by
   * `reconcileHandler` varovani „okamzita cesta nezabrala" navzdy.
   */
  it('druhy beh nad tymz stavem zrusi nula radku', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await patchContact(contactId, `status = 'unsubscribed'`);

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 1 });
    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 0 });
    expect(await states(contactId)).toEqual([{ status: 'skipped', code: 'unsubscribed' }]);
  });

  it('beh nad prazdnym projektem projde planovacem a vrati nulu', async () => {
    await expect(reconcilePending(ctx.workspace)).resolves.toEqual({ revoked: 0 });
  });

  it('vic kontaktu naraz dostane kazdy svuj vlastni duvod', async () => {
    const a = await seedMessages(ctx, { statuses: ['pending'] });
    const b = await seedMessages(ctx, { statuses: ['pending'] });
    const c = await seedMessages(ctx, { statuses: ['pending'] });
    await patchContact(a.contactId, `status = 'unsubscribed'`);
    await patchContact(b.contactId, `processing_restricted = true`);
    await addSuppression(ctx, { email: c.email, reason: 'complaint' });

    expect(await reconcilePending(ctx.workspace)).toEqual({ revoked: 3 });
    expect(await states(a.contactId)).toEqual([{ status: 'skipped', code: 'unsubscribed' }]);
    expect(await states(b.contactId)).toEqual([
      { status: 'skipped', code: 'processing_restricted' },
    ]);
    expect(await states(c.contactId)).toEqual([{ status: 'skipped', code: 'suppressed' }]);
  });
});
