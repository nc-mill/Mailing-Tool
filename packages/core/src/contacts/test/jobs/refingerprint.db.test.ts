import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keyringFromEnv, parseKeyring } from '@mlain/contracts/keyring';
import type { WorkspaceContext } from '../../../identity/types';
import { computeAllFingerprints } from '../../fingerprint';
import { refingerprintContacts } from '../../jobs/refingerprint';
import { writeContact } from '../../repo/contacts';
import { asMigrator, testContext } from '../support/db';

/**
 * Doplnění otisků adres po rotaci klíče, proti skutečné databázi.
 *
 * Fronta `contacts.refingerprint` neměla obsluhu ANI producenta, takže rotace
 * klíče skončila hlášením „přešifrováno N" a kontakty zůstaly s otiskem jen pod
 * starým pokolením. Ticho je tu ta nejhorší část: nic neselže, jen se ztratí
 * ochrana, kterou má suppression list poskytovat.
 */

const KEY_1 = Buffer.alloc(32, 7).toString('base64url');
const KEY_2 = Buffer.alloc(32, 9).toString('base64url');

/**
 * Původní prostředí se čte AŽ V beforeAll, ne na úrovni modulu. `SECRET_KEY`
 * dosazuje harness ve svém `beforeAll` (`applyHarnessEnv`), takže při importu
 * souboru ještě neexistuje a úklid po testu by ho smazal celému souboru.
 */
let originalSecretKey: string | undefined;
let originalPrevious: string | undefined;

beforeAll(() => {
  originalSecretKey = process.env['SECRET_KEY'];
  originalPrevious = process.env['SECRET_KEY_PREVIOUS'];
});

/** Prostředí po rotaci: nové pokolení podepisuje, staré zůstává v keyringu. */
function rotateEnv(): void {
  process.env['SECRET_KEY'] = `2:${KEY_2}`;
  process.env['SECRET_KEY_PREVIOUS'] = `1:${KEY_1}`;
}

afterEach(() => {
  if (originalSecretKey === undefined) delete process.env['SECRET_KEY'];
  else process.env['SECRET_KEY'] = originalSecretKey;
  if (originalPrevious === undefined) delete process.env['SECRET_KEY_PREVIOUS'];
  else process.env['SECRET_KEY_PREVIOUS'] = originalPrevious;
});

async function fingerprintsOf(ctx: WorkspaceContext, email: string): Promise<Buffer[]> {
  const { rows } = await asMigrator().query<{ email_fingerprints: Buffer[] }>(
    `SELECT email_fingerprints FROM contacts WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email],
  );
  return rows[0]?.email_fingerprints ?? [];
}

describe('contacts.refingerprint proti databázi', () => {
  it('doplní otisk pod novým pokolením a starý zachová', async () => {
    // Prostředí PŘED rotací zná jediné pokolení, takže kontakt vznikne s jedním otiskem.
    expect(keyringFromEnv().size).toBe(1);
    const ctx = await testContext();
    await writeContact(ctx, { email: 'jana@x.cz', firstName: 'Jana', attributes: {} });

    // PŘED
    const before = await fingerprintsOf(ctx, 'jana@x.cz');
    expect(before).toHaveLength(1);

    rotateEnv();
    const result = await refingerprintContacts({ keyId: 2 });

    // PO: otisk pod OBĚMA pokoleními, ten starý beze změny.
    const after = await fingerprintsOf(ctx, 'jana@x.cz');
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(after).toHaveLength(2);

    const expected = computeAllFingerprints(
      parseKeyring({ secretKey: `2:${KEY_2}`, secretKeyPrevious: `1:${KEY_1}` }),
      'jana@x.cz',
    );
    const hex = after.map((fp) => Buffer.from(fp).toString('hex')).sort();
    expect(hex).toEqual(expected.map((fp) => fp.toString('hex')).sort());
    // Otisk ze starého pokolení musí mezi nimi zůstat: bez něj by kontakt minul
    // suppression řádek zapsaný před rotací.
    expect(hex).toContain(Buffer.from(before[0]!).toString('hex'));
  });

  it('druhý běh neovlivní ani řádek (idempotence)', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'petr@x.cz', attributes: {} });

    rotateEnv();
    const first = await refingerprintContacts({ keyId: 2 });
    const second = await refingerprintContacts({ keyId: 2 });

    expect(first.updated).toBeGreaterThanOrEqual(1);
    expect(second.updated).toBe(0);
    expect(await fingerprintsOf(ctx, 'petr@x.cz')).toHaveLength(2);
  });

  it('náklad o pokolení, které keyring nezná, skončí chybou a nezapíše nic', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'ticho@x.cz', attributes: {} });
    rotateEnv();

    // Přesně ta situace, před kterou varuje rotační postup: krok 3 pustil někdo
    // dřív, než restartoval procesy, takže worker jede se starým prostředím.
    await expect(refingerprintContacts({ keyId: 3 })).rejects.toThrow(/pokolení klíče 3/);
    expect(await fingerprintsOf(ctx, 'ticho@x.cz')).toHaveLength(1);
  });

  it('anonymizovaný kontakt se nepřepočítává', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'vymazany@x.cz', attributes: {} });
    await asMigrator().query(
      `UPDATE contacts SET anonymized_at = now() WHERE workspace_id = $1 AND email = $2`,
      [ctx.workspaceId, 'vymazany@x.cz'],
    );

    rotateEnv();
    await refingerprintContacts({ keyId: 2 });

    expect(await fingerprintsOf(ctx, 'vymazany@x.cz')).toHaveLength(1);
  });

  it('kurzor přeskočí projekty, které jsou hotové', async () => {
    const first = await testContext();
    const second = await testContext();
    await writeContact(first, { email: 'prvni@x.cz', attributes: {} });
    await writeContact(second, { email: 'druhy@x.cz', attributes: {} });

    rotateEnv();
    // Kurzor je ID prvního projektu, takže se má zpracovat jen ten druhý.
    await refingerprintContacts({ keyId: 2, cursor: first.workspaceId });

    expect(await fingerprintsOf(first, 'prvni@x.cz')).toHaveLength(1);
    expect(await fingerprintsOf(second, 'druhy@x.cz')).toHaveLength(2);
  });
});
