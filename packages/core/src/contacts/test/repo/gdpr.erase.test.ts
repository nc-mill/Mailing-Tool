import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { erasedEmail } from '../../constants';
import { resetConsentEraser } from '../../gdpr/consents-role';
import { anonymizeContact } from '../../gdpr/erase';
import { writeContact } from '../../repo/contacts';
import { asMigrator, lastAuditEntry, testContext } from '../support/db';
import {
  closeGdprPool,
  contactRow,
  countRowsFor,
  countSuppressions,
  createFullContact,
  ensureQueue,
  suppressionByFingerprintOf,
  useGdprConsentEraser,
} from '../support/phase-c';

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeAll(async () => {
  await ensureQueue('gdpr.sever_links');
});

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
  useGdprConsentEraser();
});

afterEach(() => {
  resetRevokePendingMessages();
  resetConsentEraser();
});

afterAll(async () => {
  await closeGdprPool();
});

describe('anonymizace podle článku 17', () => {
  it('REGRESE: transakce projde a nespadne na 23502 ani 23514', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    // Specifikace u locale říká "NULL nebo výchozí", ale sloupec je NOT NULL
    // s regexovým CHECK. Zápis NULL by skončil 23502, prázdný řetězec 23514,
    // a výmaz by neselhal někdy, ale pokaždé.
    await expect(anonymizeContact(ctx, contact.id)).resolves.not.toThrow();
  });

  it('REGRESE: locale zůstane platné a odpovídá jazyku projektu', async () => {
    const ctx = await testContext();
    await asMigrator().query(`UPDATE workspaces SET locale = 'en' WHERE id = $1`, [
      ctx.workspaceId,
    ]);
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    const row = await contactRow(ctx, contact.id);
    expect(row['locale']).toBe('en');
    expect(String(row['locale'])).toMatch(
      /^[a-zA-Z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/,
    );
  });

  it('KRITÉRIUM 67: vyprázdní jméno, adresu i vlastní pole', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    const row = await contactRow(ctx, contact.id);

    expect(row['email']).toBe(erasedEmail(contact.id));
    expect(row['first_name']).toBeNull();
    expect(row['last_name']).toBeNull();
    expect(row['greeting']).toBe('');
    expect(row['gender']).toBe('unknown');
    expect(row['attributes']).toEqual({});
    expect(row['status']).toBe('deleted');
    expect(row['anonymized_at']).not.toBeNull();
  });

  it('KRITÉRIUM 68: email_fingerprints je po anonymizaci prázdné pole', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    // Kontakt po anonymizaci nesmí nést otisk původní adresy: byl by to druhý,
    // zbytečný záznam téhož údaje v tabulce, kterou nechráníme jako důkazní.
    // Ochranu proti vzkříšení nese výhradně suppression řádek.
    expect((await contactRow(ctx, contact.id))['email_fingerprints']).toEqual([]);
  });

  it('KRITÉRIUM 68: vznikne suppression s důvodem gdpr_erasure a otiskem původní adresy', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    const suppression = await suppressionByFingerprintOf(ctx, 'j@x.cz');
    expect(suppression?.reason).toBe('gdpr_erasure');
    expect(suppression?.fingerprint_key_id).toBe(1);
  });

  it('smaže souhlasy, přihlášení, štítky a potvrzovací tokeny', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    expect(await countRowsFor('consents', ctx, contact.id)).toBe(0);
    expect(await countRowsFor('list_subscriptions', ctx, contact.id)).toBe(0);
    expect(await countRowsFor('contact_tags', ctx, contact.id)).toBe(0);
    expect(await countRowsFor('subscription_confirmations', ctx, contact.id)).toBe(0);
  });

  it('KRITÉRIUM 64 a R13: bez role mlain_gdpr výmaz SELŽE a nic po sobě nenechá', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    resetConsentEraser();

    await expect(anonymizeContact(ctx, contact.id)).rejects.toMatchObject({
      code: 'not_implemented',
      params: { detail: 'gdpr_role_unavailable' },
    });

    // Souhlasy se mažou jako POSLEDNÍ krok, takže se zruší celá transakce
    // a po výmazu nezůstane polovina anonymizovaného kontaktu.
    const row = await contactRow(ctx, contact.id);
    expect(row['anonymized_at']).toBeNull();
    expect(row['first_name']).toBe('Jana');
    expect(await countSuppressions(ctx)).toBe(0);
  });

  it('vyprázdní osobní údaje v odeslaných formulářích', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    const { rows: forms } = await asMigrator().query<{ id: string }>(
      `INSERT INTO forms (workspace_id, name, slug, fields)
       VALUES ($1, 'Formulář', $2, '[]'::jsonb) RETURNING id`,
      // ck_forms__slug žádá 16 až 32 znaků z [a-z0-9].
      [ctx.workspaceId, `f${Date.now()}${Math.random().toString(36).slice(2)}`.slice(0, 24)],
    );
    await asMigrator().query(
      `INSERT INTO form_submissions (workspace_id, form_id, contact_id, status, payload, ip)
       VALUES ($1, $2, $3, 'accepted', $4::jsonb, '1.2.3.4')`,
      [ctx.workspaceId, forms[0]!.id, contact.id, JSON.stringify({ email: 'j@x.cz' })],
    );

    await anonymizeContact(ctx, contact.id);

    const submission = await asMigrator().query<{ payload: unknown; ip: string | null }>(
      `SELECT payload, ip FROM form_submissions WHERE contact_id = $1`,
      [contact.id],
    );
    expect(submission.rows[0]!.payload).toEqual({});
    expect(submission.rows[0]!.ip).toBeNull();
  });

  it('zavolá revokePendingMessages s důvodem contact_anonymized', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        contactIds: [contact.id],
        listId: null,
        reason: 'contact_anonymized',
      }),
    );
  });

  it('do auditu se neuloží e-mail, jen otisk', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    const entry = await lastAuditEntry(ctx);
    expect(entry?.action).toBe('contact.anonymized');
    expect(JSON.stringify(entry?.metadata)).not.toContain('j@x.cz');
    expect(entry?.metadata).toHaveProperty('fingerprint');
  });

  it('druhé volání je bez efektu, job je idempotentní', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    await expect(anonymizeContact(ctx, contact.id)).resolves.toEqual({ alreadyAnonymized: true });
    expect(await countSuppressions(ctx)).toBe(1);
  });

  it('KRITÉRIUM 69: import vymazané adresy kontakt nevytvoří', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await anonymizeContact(ctx, contact.id);
    const result = await writeContact(ctx, { email: 'j@x.cz', attributes: {} });
    expect(result.rejected).toBe('suppressed');
  });
});
