import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withoutContext } from '../../tx';
import { setSystemMailer, type SystemMail } from '../../platform/system-mail';
import { loadConfig } from '../../config';
import { createWorkspaceContext } from '../../identity/context';
import { hashPassword } from '../../identity/password';
import { createWorkspace } from '../../identity/workspace-service';
import { addTrialVerifiedAddress } from './trial-service';

/**
 * JAZYK E-MAILU, KTERÝM SE OVĚŘUJE ODESÍLACÍ ADRESA VE ZKUŠEBNÍM REŽIMU.
 *
 * Do 7. 8. 2026 se bral z `DEFAULT_LOCALE`, tedy z jazyka CELÉ INSTALACE, takže
 * česká instalace poslala do anglického projektu český e-mail. Je to týž tvar
 * vady, jaký měla pozvánka, a stejné je i řešení: vlastní jazyk adresáta se
 * vzít nedá (ověřuje se odesílací adresa, která nemusí patřit žádnému
 * uživateli produktu), ale projekt, jehož odesílatel se ověřuje, k dispozici je.
 *
 * Test čte, co se doopravdy zařadilo k odeslání, ne co si funkce myslí:
 * odesílatel se na dobu testu nahradí sběračem přes `setSystemMailer`.
 */

const PASSWORD = 'dostatecne-dlouhe-heslo';

let harness: PgHarness;

async function makeUser(prefix: string): Promise<{ id: string; email: string }> {
  const id = uuidv7();
  const email = `${prefix}-${id}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id,
      email,
      passwordHash: await hashPassword(PASSWORD),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  return { id, email };
}

beforeAll(async () => {
  harness = await startPgHarness();
  setSystemMailer({ async send() {} });
}, 300_000);

afterAll(async () => {
  setSystemMailer(null);
  await closePools();
  await harness?.stop();
}, 120_000);

async function odchytPriOvereni(locale: string): Promise<SystemMail[]> {
  const owner = await makeUser(`trial-${locale}`);
  const created = await createWorkspace(owner.id, owner.email, {
    name: `Projekt ${locale} ${Date.now()}`,
    locale,
  });
  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: owner.id,
    workspaceRef: created.workspace.id,
  });

  const sent: SystemMail[] = [];
  setSystemMailer({
    async send(mail) {
      sent.push(mail);
    },
  });
  try {
    await addTrialVerifiedAddress(ctx, `odesilatel-${Date.now()}@example.cz`);
  } finally {
    setSystemMailer({ async send() {} });
  }
  return sent;
}

describe('jazyk ověření odesílací adresy ve zkušebním režimu', () => {
  it('do anglického projektu odchází anglicky, i když instalace jede česky', async () => {
    // Bez tohohle rozdílu by test nedokazoval nic: kdyby byla instalace
    // anglická, prošla by i vadná verze, která bere jazyk z instalace.
    expect(loadConfig().DEFAULT_LOCALE).toBe('cs');

    const sent = await odchytPriOvereni('en');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.template).toBe('trial_address_verification');
    expect(sent[0]!.locale).toBe('en');
  });

  it('do českého projektu odchází česky', async () => {
    const sent = await odchytPriOvereni('cs');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.locale).toBe('cs');
  });
});
