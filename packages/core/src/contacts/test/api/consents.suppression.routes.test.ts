import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { registerConsentRoutes } from '../../api/consents.routes';
import { writeContact } from '../../repo/contacts';
import { addSuppression } from '../../repo/suppressions';
import { asMigrator, testContext } from '../support/db';
import { apiHarness, JSON_HEADERS } from './harness';

/**
 * `POST /contacts/{id}/consents` proti adrese na suppression listu.
 *
 * Tady se pravidlo 4 vymáhá ODMÍTNUTÍM, ne přeskokem: obsahem požadavku je právě
 * ten souhlas, takže 201 s tichým zahozením by klientovi tvrdilo, že souhlas existuje.
 *
 * Test běží nad SKUTEČNOU databází a přes skutečnou routu, ne nad podvrženým repozitářem:
 * podvržený repozitář by dokázal jen to, že handler volá funkci, kterou mu test nastrčil.
 */

async function contactFor(ctx: WorkspaceContext, email: string): Promise<string> {
  const written = await writeContact(ctx, { email, attributes: {} });
  if (written.rejected !== null) throw new Error('kontakt se nezapsal');
  return written.id;
}

async function post(ctx: WorkspaceContext, contactId: string, body: unknown): Promise<Response> {
  return apiHarness(registerConsentRoutes, { ctx }).request(`/contacts/${contactId}/consents`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function consentStatuses(ctx: WorkspaceContext, contactId: string): Promise<string[]> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT status FROM consents WHERE workspace_id = $1 AND contact_id = $2`,
    [ctx.workspaceId, contactId],
  );
  return rows.map((row) => row.status);
}

describe('POST /contacts/{id}/consents', () => {
  it('udělení souhlasu blokované adrese vrací 409 a nic nezapíše', async () => {
    const ctx = await testContext();
    const contactId = await contactFor(ctx, 'blok@example.cz');
    await addSuppression(ctx, { email: 'blok@example.cz', reason: 'manual', source: 'test' });

    const res = await post(ctx, contactId, {
      purpose: 'email_marketing',
      status: 'granted',
      legal_basis: 'consent',
    });

    expect(res.status).toBe(409);
    expect((await res.json()).params.detail).toBe('contact_suppressed');
    expect(await consentStatuses(ctx, contactId)).toEqual([]);
  });

  it('odvolání souhlasu projde i blokované adrese', async () => {
    const ctx = await testContext();
    const contactId = await contactFor(ctx, 'odvolani@example.cz');
    await addSuppression(ctx, { email: 'odvolani@example.cz', reason: 'manual', source: 'test' });

    const res = await post(ctx, contactId, {
      purpose: 'email_marketing',
      status: 'withdrawn',
      legal_basis: 'consent',
    });

    expect(res.status).toBe(201);
    expect(await consentStatuses(ctx, contactId)).toEqual(['withdrawn']);
  });

  it('kontakt bez blokace souhlas dostane', async () => {
    const ctx = await testContext();
    const contactId = await contactFor(ctx, 'cisty@example.cz');

    const res = await post(ctx, contactId, {
      purpose: 'email_marketing',
      status: 'granted',
      legal_basis: 'consent',
    });

    expect(res.status).toBe(201);
    expect(await consentStatuses(ctx, contactId)).toEqual(['granted']);
  });
});
