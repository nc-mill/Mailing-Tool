import { describe, expect, it } from 'vitest';
import { changeContactEmail, writeContact } from '../../repo/contacts';
import { addSuppression } from '../../repo/suppressions';
import { findByEmail, findByEmailOrNull, lastAuditEntry, testContext } from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

async function write(ctx: WorkspaceContext, email: string): Promise<{ id: string }> {
  const result = await writeContact(ctx, { email, attributes: {} });
  if (result.rejected !== null) throw new Error(`kontakt ${email} byl potlačený`);
  return { id: result.id };
}

describe('changeContactEmail', () => {
  it('změní adresu a přepočítá otisky', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'stary@x.cz');
    const before = (await findByEmail(ctx, 'stary@x.cz')).email_fingerprints.map((f) =>
      Buffer.from(f).toString('hex'),
    );
    await changeContactEmail(ctx, id, 'novy@x.cz');
    const contact = await findByEmail(ctx, 'novy@x.cz');
    expect(contact.id).toBe(id);
    expect(contact.email_fingerprints.length).toBeGreaterThan(0);
    expect(contact.email_fingerprints.map((f) => Buffer.from(f).toString('hex'))).not.toEqual(
      before,
    );
  });

  it('normalizuje novou adresu stejně jako každý jiný kanál', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'stary@x.cz');
    await changeContactEmail(ctx, id, '  NOVY@X.CZ  ');
    expect(await findByEmailOrNull(ctx, 'novy@x.cz')).not.toBeNull();
  });

  it('odmítne adresu, kterou už má jiný živý kontakt', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'a@x.cz');
    await write(ctx, 'b@x.cz');
    await expect(changeContactEmail(ctx, id, 'b@x.cz')).rejects.toMatchObject({
      code: 'already_exists',
      params: { detail: 'email_taken_by_live_contact' },
    });
  });

  it('odmítne neplatnou adresu', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'a@x.cz');
    await expect(changeContactEmail(ctx, id, 'nesmysl')).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('odmítne adresu na suppression listu se stížností', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'a@x.cz');
    await addSuppression(ctx, { email: 'b@x.cz', reason: 'complaint', source: 'api' });
    await expect(changeContactEmail(ctx, id, 'b@x.cz')).rejects.toMatchObject({
      code: 'conflict',
      params: { detail: 'contact_suppressed' },
    });
  });

  it('zapíše do auditu obě adresy', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'a@x.cz');
    await changeContactEmail(ctx, id, 'b@x.cz');
    const entry = await lastAuditEntry(ctx);
    expect(entry?.action).toBe('contact.email_changed');
    // Redakce metadat z P04 klíč `email` vyhazuje, ale `from` a `to` nechává:
    // bez nich by záznam o změně adresy neměl žádnou vypovídací hodnotu.
    expect(entry?.metadata).toMatchObject({ from: 'a@x.cz', to: 'b@x.cz' });
  });
});
