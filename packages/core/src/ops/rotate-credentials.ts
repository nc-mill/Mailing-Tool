import { sql } from 'drizzle-orm';
import { decryptEnvelope, encryptEnvelope, envelopeKeyId } from '@mlain/contracts/crypto';
import { currentKeyId, parseKeyring } from '@mlain/contracts/keyring';
import { writeAuditLog } from '../audit/write';
import { enqueue } from '../contacts/jobs/enqueue';
import { withoutContext } from '../tx';
import { OPS_AUDIT_ACTIONS } from './audit';
import { withAdminTx } from './db';
import { ENCRYPTED_COLUMNS, unregisteredEncryptedColumns } from './encrypted-columns';

export type RotateInput = {
  /**
   * Vždy `DATABASE_URL_MIGRATOR`. Všechny čtyři tabulky s obálkami mají
   * `ws_isolation`, takže pod aplikační rolí by `SELECT` nenašel ani jeden
   * řádek a rotace by skončila hlášením „přešifrováno 0, vše aktuální".
   */
  adminUrl: string;
  secretKey: string;
  secretKeyPrevious: string;
  batchSize?: number;
};

export type RotateReport = {
  rotated: number;
  alreadyCurrent: number;
  failed: string[];
  notice: string;
};

const NOTICE =
  'SECRET_KEY_PREVIOUS nechte beze změny. Přešifrovat jdou jen uložená tajemství. ' +
  'Trackovací tokeny ve starých e-mailech a otisky smazaných adres přešifrovat nejde nikdy, ' +
  'takže odebrání starého pokolení je tichá ztráta ochrany.';

export async function rotateCredentials(input: RotateInput): Promise<RotateReport> {
  const stray = await unregisteredEncryptedColumns(input.adminUrl);
  if (stray.length > 0) {
    throw new Error(
      `Ve schématu jsou šifrované sloupce, které nejsou v registru: ${stray.join(', ')}. ` +
        'Rotace by je tiše přeskočila a po odebrání starého klíče by je nešlo dešifrovat. ' +
        'Doplňte je do ENCRYPTED_COLUMNS a spusťte rotaci znovu.',
    );
  }

  const keyring = parseKeyring({
    secretKey: input.secretKey,
    secretKeyPrevious: input.secretKeyPrevious,
  });
  const targetKeyId = currentKeyId(keyring);
  const batchSize = input.batchSize ?? 500;

  let rotated = 0;
  let alreadyCurrent = 0;
  const failed: string[] = [];

  await withAdminTx(input.adminUrl, async (tx) => {
    for (const col of ENCRYPTED_COLUMNS) {
      const { rows: exists } = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_tables
             WHERE schemaname = 'public' AND tablename = ${col.table}`,
      );
      if (exists[0]!.n === 0) continue;

      const pkList = col.primaryKey.map((c) => `"${c}"`).join(', ');
      // workspace_id se čte VŽDY. Obálka je přes AAD vázaná na projekt
      // (kontrakt 4.10.4), takže bez něj dešifrování selže a rotace by
      // ohlásila poškozená data tam, kde jsou v pořádku jen její vstupy.
      const { rows } = await tx.execute<Record<string, unknown>>(
        sql`SELECT ${sql.raw(pkList)}, workspace_id, ${sql.raw(`"${col.column}"`)} AS value
              FROM ${sql.raw(`"${col.table}"`)}
             WHERE ${sql.raw(`"${col.column}"`)} IS NOT NULL`,
      );

      for (let i = 0; i < rows.length; i += batchSize) {
        for (const row of rows.slice(i, i + batchSize)) {
          const stored = row['value'] as string;
          const workspaceId = String(row['workspace_id']);
          const rowId = col.primaryKey.map((c) => String(row[c])).join('/');

          let keyId: number;
          try {
            keyId = envelopeKeyId(stored);
          } catch {
            failed.push(`${col.table}.${col.column} #${rowId}: obálku nejde přečíst`);
            continue;
          }
          if (keyId === targetKeyId) {
            alreadyCurrent += 1;
            continue;
          }
          if (!keyring.has(keyId)) {
            failed.push(`${col.table}.${col.column} #${rowId}: chybí klíč pokolení ${keyId}`);
            continue;
          }

          let plaintext: string;
          try {
            plaintext = decryptEnvelope({
              stored,
              context: col.context,
              workspaceId,
              keyring,
            });
          } catch {
            failed.push(`${col.table}.${col.column} #${rowId}: dešifrování selhalo`);
            continue;
          }

          const reencrypted = encryptEnvelope({
            plaintext,
            keyId: targetKeyId,
            keyring,
            context: col.context,
            workspaceId,
          });
          const where = col.primaryKey
            .map((c) => sql`${sql.raw(`"${c}"`)} = ${row[c]}`)
            .reduce((a, b) => sql`${a} AND ${b}`);
          await tx.execute(
            sql`UPDATE ${sql.raw(`"${col.table}"`)}
                   SET ${sql.raw(`"${col.column}"`)} = ${reencrypted.stored},
                       updated_at = now()
                 WHERE ${where}`,
          );
          rotated += 1;
        }
      }
    }

    await writeAuditLog(tx, {
      action: OPS_AUDIT_ACTIONS['credentials.rotated'],
      workspaceId: null,
      actor: { actorType: 'system', actorId: null, actorLabel: 'mlain rotate-credentials' },
      targetType: 'installation',
      targetId: null,
      metadata: { rotated, already_current: alreadyCurrent, failed: failed.length },
    });
  });

  return { rotated, alreadyCurrent, failed, notice: NOTICE };
}

/**
 * Zařadí doplnění otisků adres pod novým pokolením klíče.
 *
 * PROČ TO NEDĚLÁ `rotateCredentials` SÁM. Rotace běží pod `DATABASE_URL_MIGRATOR`
 * a její transakce sahá výhradně do tabulek s obálkami. Fronta pg-boss je jiné
 * schéma, jiná role a hlavně jiná záruka: přešifrování tajemství musí projít
 * i tam, kde worker nikdy neběžel, a tedy ani schéma fronty neexistuje. Zařazení
 * je proto samostatný krok, který volá příkaz CLI po úspěšné rotaci a jehož
 * selhání se hlásí zvlášť.
 *
 * `singletonKey` je `global`, protože rotace je operace nad celou instalací
 * a dvě souběžné úlohy by procházely tytéž kontakty.
 *
 * Otisky suppression řádků tudy NEJDOU a jít nemůžou: adresa vymazaného člověka
 * po výmazu podle článku 17 neexistuje, takže se její otisk nedá přepočítat.
 * Právě proto se staré pokolení ze SECRET_KEY_PREVIOUS nikdy neodebírá.
 *
 * Pokolení se DOPOČÍTÁVÁ TADY z předaného keyringu, nebere se parametrem. Příkaz
 * CLI by na jeho spočítání potřeboval `@mlain/contracts/keyring`, a `apps/cli`
 * na kontrakty podle grafu závislostí sahat nesmí. Vstup je proto týž objekt,
 * jaký příkaz předává do `rotateCredentials`, takže se obojí nemůže rozejít.
 */
export async function enqueueRefingerprint(keys: {
  secretKey: string;
  secretKeyPrevious: string;
}): Promise<void> {
  const keyId = currentKeyId(parseKeyring(keys));
  await withoutContext(async (tx) => {
    await enqueue(tx, 'contacts.refingerprint', { keyId }, { singletonKey: 'global' });
  });
}
