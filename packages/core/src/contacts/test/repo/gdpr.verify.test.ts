import { beforeAll, describe, expect, it } from 'vitest';
import {
  completeGdprRequest,
  createGdprRequest,
  findRequestsForSubject,
  processGdprRequest,
  verifyGdprRequest,
} from '../../repo/gdpr';
import { createActiveContact, testContext } from '../support/db';
import { ensureQueue, gdprRequestRow, withKeyring } from '../support/phase-c';

beforeAll(async () => {
  // Zpracování žádosti zařazuje job, a `pgboss.job` má cizí klíč na `pgboss.queue`.
  await ensureQueue('gdpr.erase');
  await ensureQueue('gdpr.export_subject');
});

describe('ověření totožnosti', () => {
  it('žádost ze stránky předvoleb je ověřená hned', async () => {
    const ctx = await testContext();
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'access',
      channel: 'preference_center',
    });
    expect(request.status).toBe('processing');
  });

  it('žádost z administrace čeká na ověření', async () => {
    const ctx = await testContext();
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'access',
      channel: 'admin',
    });
    expect(request.status).toBe('verifying');
  });

  it('neověřená žádost o výmaz se neprovede', async () => {
    const ctx = await testContext();
    await createActiveContact(ctx, 'j@x.cz');
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'erasure',
      channel: 'admin',
    });
    await expect(processGdprRequest(ctx, request.id)).rejects.toMatchObject({
      code: 'forbidden',
      params: { detail: 'gdpr_not_verified' },
    });
  });

  it('po ověření se žádost provést dá', async () => {
    const ctx = await testContext();
    await createActiveContact(ctx, 'j@x.cz');
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'erasure',
      channel: 'admin',
    });
    await verifyGdprRequest(ctx, request.id);
    await expect(processGdprRequest(ctx, request.id)).resolves.not.toThrow();
  });

  it('ověření zapíše čas a posune stav', async () => {
    const ctx = await testContext();
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'access',
      channel: 'admin',
    });
    await verifyGdprRequest(ctx, request.id);
    const row = await gdprRequestRow(ctx, request.id);
    expect(row.status).toBe('processing');
    expect(row.verified_at).not.toBeNull();
  });

  it('vyřízenou žádost už nejde zpracovat znovu', async () => {
    const ctx = await testContext();
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'access',
      channel: 'preference_center',
    });
    await completeGdprRequest(ctx, request.id);
    await expect(processGdprRequest(ctx, request.id)).rejects.toMatchObject({
      code: 'invalid_state_transition',
    });
  });

  it('žádosti téhož subjektu jdou dohledat přes otisk i po rotaci klíče', async () => {
    const ctx = await testContext();
    await withKeyring({ current: 1, all: [1] }, async () => {
      await createGdprRequest(ctx, { email: 'j@x.cz', type: 'access', channel: 'admin' });
    });
    await withKeyring({ current: 2, all: [1, 2] }, async () => {
      expect(await findRequestsForSubject(ctx, 'j@x.cz')).toHaveLength(1);
    });
  });

  it('žádost bez ověření se nedá zpracovat ani opakovaně, stav zůstává verifying', async () => {
    const ctx = await testContext();
    const request = await createGdprRequest(ctx, {
      email: 'j@x.cz',
      type: 'erasure',
      channel: 'api',
    });
    await expect(processGdprRequest(ctx, request.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(processGdprRequest(ctx, request.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect((await gdprRequestRow(ctx, request.id)).status).toBe('verifying');
  });
});
