import { sql } from 'drizzle-orm';
import { currentKeyId, keyringFromEnv, type Keyring } from '@mlain/contracts/keyring';
import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { withWorkspace } from '../../tx';
import { REFINGERPRINT_BATCH_SIZE } from '../constants';
import { computeAllFingerprints } from '../fingerprint';
import { byteaArrayLiteral } from '../repo/bytea';

export type RefingerprintPayload = {
  /**
   * Pokolení, kvůli kterému se běh spustil. Nepovinné, ale producent ho posílá:
   * job pak umí říct NAHLAS, že běží s prostředím, ve kterém ten klíč není.
   */
  keyId?: number;
  /**
   * Kde navázat, tedy ID projektu, ZA kterým se má pokračovat. Projekty se
   * procházejí v pořadí, ve kterém je vrací sken, takže přerušený běh se dá
   * spustit znovu bez opakování hotové práce. Uvnitř projektu si kurzor nad
   * kontakty drží job sám.
   */
  cursor?: string;
};

/**
 * Po rotaci SECRET_KEY doplní kontaktům otisk adresy pod NOVÝM pokolením klíče.
 *
 * PROČ TO JDE U KONTAKTU A NE U SUPPRESSION ŘÁDKU. U kontaktu máme plaintext
 * adresy, takže se otisk dá dopočítat. U vymazané adresy plaintext neexistuje
 * a přepočítat ho nejde nikdy, a přesně proto kontrola suppression prochází
 * všechna pokolení a nemá strop. Tenhle job tu asymetrii nemění, jen dorovnává
 * tu stranu, kterou dorovnat lze.
 *
 * KDY SE ZAŘAZUJE. Producentem je `mlain rotate-credentials`, tedy krok 3
 * rotačního postupu z `ops/genkey.ts`. Zařazuje se AŽ po přešifrování uložených
 * tajemství, protože do té chvíle nemusí mít worker nové pokolení v prostředí.
 *
 * KONTROLA POKOLENÍ. Když náklad nese `keyId` a keyring z prostředí ho nezná,
 * job skončí VÝJIMKOU. Je to ta situace, před kterou varuje rotační postup:
 * někdo pustil krok 3 dřív, než restartoval procesy, takže worker jede se starou
 * konfigurací. Bez téhle kontroly by běh doplnil otisky pod STARÝM pokolením,
 * vrátil "hotovo" a nikdo by se nedozvěděl, že práci je potřeba udělat znovu.
 *
 * PROČ TO BĚŽÍ NAPŘÍČ PROJEKTY. Rotace klíče je operace nad celou instalací
 * a fronta má `singletonKey` `global`. Postup je ten závazný dvoutaktní: sken
 * pod rolí `mlain_maintenance` vrátí POUZE ID projektů, veškerá další práce běží
 * pod `mlain_app` v systémovém kontextu jednoho projektu, takže na ni dopadá RLS
 * stejně jako na požadavek z API.
 *
 * Idempotence: doplňuje se jen tam, kde otisk pod daným pokolením ještě není,
 * takže druhý běh ovlivní nula řádků. Přesně to tvrdí
 * `CONTACTS_QUEUES['contacts.refingerprint']`.
 */
export async function refingerprintContacts(
  payload: RefingerprintPayload = {},
): Promise<{ workspaces: number; updated: number }> {
  const keyring = keyringFromEnv();
  assertKeyringKnows(keyring, payload.keyId);

  const workspaceIds = await listWorkspaceIds();
  const cursor = payload.cursor;
  const pending =
    cursor === undefined ? workspaceIds : workspaceIds.slice(workspaceIds.indexOf(cursor) + 1);

  let updated = 0;
  for (const workspaceId of pending) {
    const ctx = createSystemContext(workspaceId, 'contacts.refingerprint');
    updated += await refingerprintWorkspace(ctx, keyring);
  }

  return { workspaces: pending.length, updated };
}

function assertKeyringKnows(keyring: Keyring, keyId: number | undefined): void {
  if (keyId === undefined || keyring.has(keyId)) return;
  throw new Error(
    `Náklad contacts.refingerprint mluví o pokolení klíče ${keyId}, ale keyring z prostředí ` +
      `zná jen ${[...keyring.keys()].join(', ')} a podepisuje pokolením ${currentKeyId(keyring)}. ` +
      'Worker tedy běží se starou konfigurací: rotační postup žádá restart VŠECH procesů ' +
      '(krok 2) dřív, než se pustí rotate-credentials (krok 3). Doplnit otisky teď by je ' +
      'doplnilo pod starým pokolením a běh by ohlásil úspěch.',
  );
}

/**
 * Jeden projekt. Průchod jde kurzorem přes `id`, ne přes OFFSET, a kurzor se
 * posouvá i u dávky, která nic nezměnila.
 *
 * Ten posun je tu jako pojistka proti nekonečnému cyklu, ne z pohodlí. Podmínka
 * výběru se ptá na POČET otisků, takže kontakt, kterému se počet nedorovná
 * (třeba proto, že v jeho poli leží otisk pokolení, které už v prostředí není),
 * by se do každé další dávky vracel a job by běžel navždy.
 *
 * Anonymizované kontakty se vynechávají: po výmazu podle článku 17 je v adrese
 * zástupná hodnota a otisk z ní by neodpovídal ničemu.
 */
async function refingerprintWorkspace(ctx: WorkspaceContext, keyring: Keyring): Promise<number> {
  let cursor = '00000000-0000-0000-0000-000000000000';
  let updated = 0;

  for (;;) {
    const batch = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string; email: string }>(sql`
        SELECT id, email::text AS email
          FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND id > ${cursor}::uuid
           AND deleted_at IS NULL
           AND anonymized_at IS NULL
           -- Levná podmínka: kontakt, který nemá tolik otisků, kolik je pokolení
           -- klíče. Otisk konkrétní adresy se v SQL spočítat nedá, protože recept
           -- je HMAC nad klíčem odvozeným přes HKDF a ten databáze nezná.
           AND coalesce(array_length(email_fingerprints, 1), 0) < ${keyring.size}
         ORDER BY id
         LIMIT ${REFINGERPRINT_BATCH_SIZE}
      `);
      return rows;
    });
    if (batch.length === 0) return updated;

    cursor = batch.reduce((max, row) => (row.id > max ? row.id : max), cursor);
    updated += await writeFingerprints(ctx, batch, keyring);
  }
}

/**
 * Zápis jedné dávky JEDNÍM příkazem.
 *
 * Otisky jdou do dotazu jako `text[]` hotových literálů pole `bytea`, tedy přesně
 * tak, jak je posílá upsert kontaktu (`repo/bytea.ts`). Přirozenější tvar
 * `unnest(${ids}::uuid[], ${fingerprints}::bytea[][])` NEFUNGUJE a je to past,
 * která projde typovou kontrolou i revizí: `unnest` dvourozměrné pole ZPLOŠTÍ,
 * takže by se dvojice rozpadla a kontakty by dostaly cizí otisky. Otisk pod cizí
 * adresou je horší než chybějící: kontrola suppression by pak označila za
 * blokovaného někoho jiného.
 *
 * Otisky se vždy SJEDNOCUJÍ, nikdy nepřepisují, stejně jako v upsertu kontaktu:
 * kontakt musí nést otisk pod každým známým pokolením, jinak by minul suppression
 * řádek zapsaný jiným.
 */
async function writeFingerprints(
  ctx: WorkspaceContext,
  batch: readonly { id: string; email: string }[],
  keyring: Keyring,
): Promise<number> {
  const ids = batch.map((row) => row.id);
  const fingerprints = batch.map((row) =>
    byteaArrayLiteral(computeAllFingerprints(keyring, row.email)),
  );

  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE contacts AS c
         SET email_fingerprints = (
               SELECT coalesce(array_agg(DISTINCT f), '{}')
                 FROM unnest(c.email_fingerprints || u.fingerprints::bytea[]) AS f
             ),
             updated_at = now()
        FROM unnest(${sql.param(ids)}::uuid[], ${sql.param(fingerprints)}::text[])
               AS u(id, fingerprints)
       WHERE c.id = u.id AND c.workspace_id = ${ctx.workspaceId}::uuid
      RETURNING c.id
    `);
    return result.rows.length;
  });
}
