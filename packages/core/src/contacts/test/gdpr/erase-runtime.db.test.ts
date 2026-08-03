import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { erasedEmail } from '../../constants';
import { installConsentEraser } from '../../gdpr/consents-role-runtime';
import { resetConsentEraser } from '../../gdpr/consents-role';
import { runGdprErase } from '../../jobs/gdpr-erase';
import { createGdprRequest } from '../../repo/gdpr';
import { closePools } from '../../../tx';
import { asMigrator, testContext } from '../support/db';
import {
  contactRow,
  countRowsFor,
  countSuppressions,
  createFullContact,
  ensureQueue,
  gdprRequestRow,
} from '../support/phase-c';

/**
 * PRODUKČNÍ cesta výmazu podle článku 17, celá, pod rolí `mlain_gdpr`.
 *
 * Rozdíl proti `repo/gdpr.erase.test.ts` je jediný a je to celý smysl tohohle
 * souboru: tam si mazač souhlasů staví testovací podpora sama
 * (`useGdprConsentEraser` v `phase-c.ts`), takže se ověřovala OBCHÁZKA. Tady se
 * volá `installConsentEraser()`, tedy tentýž kompoziční kořen, který volá
 * `apps/worker/src/main.ts`, a spojení se bere z `DATABASE_URL_GDPR`.
 *
 * Do zapojení toho kořene selhal KAŽDÝ výmaz v režimu `anonymize`, tedy
 * ve výchozím režimu, na `gdpr_role_unavailable`.
 */

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeAll(async () => {
  await ensureQueue('gdpr.sever_links');
  await ensureQueue('gdpr.erase');
});

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
  installConsentEraser();
});

afterEach(() => {
  resetRevokePendingMessages();
  resetConsentEraser();
});

describe('gdpr.erase v režimu anonymize pod produkčním připojením', () => {
  it('DŮKAZ: úloha DOBĚHNE a kontakt je anonymizovaný', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'jana.novakova@example.cz');
    const request = await createGdprRequest(ctx, {
      email: 'jana.novakova@example.cz',
      type: 'erasure',
      mode: 'anonymize',
      channel: 'preference_center',
    });

    // PŘED: kontakt má jméno, vlastní pole i souhlas.
    const before = await contactRow(ctx, contact.id);
    expect(before['first_name']).toBe('Jana');
    expect(await countRowsFor('consents', ctx, contact.id)).toBeGreaterThan(0);

    const result = await runGdprErase({ workspaceId: ctx.workspaceId, requestId: request.id });
    expect(result).toEqual({ mode: 'anonymize', skipped: false });

    // PO: osobní údaje pryč, souhlasy smazané, žádost uzavřená.
    const after = await contactRow(ctx, contact.id);
    expect(after['email']).toBe(erasedEmail(contact.id));
    expect(after['first_name']).toBeNull();
    expect(after['last_name']).toBeNull();
    expect(after['attributes']).toEqual({});
    expect(after['status']).toBe('deleted');
    expect(after['anonymized_at']).not.toBeNull();
    expect(await countRowsFor('consents', ctx, contact.id)).toBe(0);

    const row = await gdprRequestRow(ctx, request.id);
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();
  });

  it('souhlasy maže ROLE mlain_gdpr, ne aplikační role', async () => {
    // Kdyby to dělala aplikační role, skončil by DELETE na 42501: migrace 0006
    // jí právo odebírá. Test to ověřuje z druhé strany, nad týmž řádkem.
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'role@example.cz');

    const { rows } = await asMigrator().query<{ app_delete: boolean; gdpr_delete: boolean }>(
      `SELECT has_table_privilege('mlain_app', 'consents', 'DELETE')  AS app_delete,
              has_table_privilege('mlain_gdpr', 'consents', 'DELETE') AS gdpr_delete`,
    );
    expect(rows[0]?.app_delete).toBe(false);
    expect(rows[0]?.gdpr_delete).toBe(true);

    const request = await createGdprRequest(ctx, {
      email: 'role@example.cz',
      type: 'erasure',
      mode: 'anonymize',
      channel: 'preference_center',
    });
    await runGdprErase({ workspaceId: ctx.workspaceId, requestId: request.id });
    expect(await countRowsFor('consents', ctx, contact.id)).toBe(0);
  });

  it('REGRESE: bez DATABASE_URL_GDPR výmaz SELŽE a nic po sobě nenechá', async () => {
    // Operátor, který proměnnou nenastaví, nesmí dostat tichý úspěch. Kontakt
    // musí zůstat celý, protože souhlasy jsou POSLEDNÍ krok transakce.
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'bezrole@example.cz');
    const request = await createGdprRequest(ctx, {
      email: 'bezrole@example.cz',
      type: 'erasure',
      mode: 'anonymize',
      channel: 'preference_center',
    });

    const original = process.env['DATABASE_URL_GDPR'];
    delete process.env['DATABASE_URL_GDPR'];
    // Konfigurace se v adaptéru čte líně a jednou; `closePools` ji zapomene.
    await closePools();
    try {
      await expect(
        runGdprErase({ workspaceId: ctx.workspaceId, requestId: request.id }),
      ).rejects.toThrow(/DATABASE_URL_GDPR/);

      const row = await contactRow(ctx, contact.id);
      expect(row['anonymized_at']).toBeNull();
      expect(row['first_name']).toBe('Jana');
      expect(await countSuppressions(ctx)).toBe(0);
      expect(await countRowsFor('consents', ctx, contact.id)).toBeGreaterThan(0);
    } finally {
      if (original !== undefined) process.env['DATABASE_URL_GDPR'] = original;
      await closePools();
    }
  });
});
